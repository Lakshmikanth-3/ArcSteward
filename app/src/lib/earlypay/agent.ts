// ArcSteward EarlyPay treasury agent (library; used by the CLI and the API route).
// Reads supplier offers for one vault from EarlyPayLedger, decides PAY_EARLY / HOLD /
// ESCALATE / REJECT, records each decision in the hash-chained ledger log, pays early
// through ArcVault.pay, links the settlement, and alerts the owner.
// Payment semantics match @velo402/arc-sdk: simulate against the live contract first,
// a refusal is never sent, and a submitted payment is never retried automatically.
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, http, type PublicClient } from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { network } from '../arc/config';
import { ledgerAbi, vaultAbi } from '../arc/abi';
import { LEDGER, LEDGER_FROM_BLOCK } from './ledger';
import { fetchOffers, fetchDecisions, fetchSettlements, readFacts, type SubmittedOffer } from './chain';
import { decide, type Llm, type DecisionResult } from './decide';
import { encodeNote, inputsHash } from './log';
import { usdc } from './math';
import { DECISIONS, DEFAULT_POLICY, type EarlyPayPolicy, type Hex } from './types';
import { llmFromEnv } from './llm';

export function policyFromEnv(): EarlyPayPolicy {
  const n = (k: string, d: number) => Number(process.env[k] ?? d);
  return {
    ...DEFAULT_POLICY,
    holdYieldBps: n('EARLYPAY_HOLD_YIELD_BPS', DEFAULT_POLICY.holdYieldBps),
    hurdleMarginBps: n('EARLYPAY_MARGIN_BPS', DEFAULT_POLICY.hurdleMarginBps),
    liquidityBuffer: BigInt(Math.round(n('EARLYPAY_BUFFER_USDC', 2) * 1e6)),
    holdYieldSource: 'simulated', // USYC is not available on Arc testnet (see docs/EARLYPAY.md)
  };
}

export type RunResult = { offerHash: Hex; invoice?: string; decision: string; reason: string; source: string; overridden?: string; decisionTx?: Hex; paymentTx?: Hex; settlementTx?: Hex; error?: string };

export class EarlyPayAgent {
  readonly pub: PublicClient;
  readonly ledger: Hex;
  readonly from: bigint;
  private wallet;
  constructor(readonly account: PrivateKeyAccount, readonly vault: Hex, readonly net: 'testnet' | 'mainnet', readonly policy: EarlyPayPolicy, readonly llm?: Llm, rpc?: string, readonly notify: (text: string) => Promise<unknown> = async () => undefined) {
    const chain = network(net);
    const ledger = LEDGER[net];
    if (!ledger) throw new Error(`EarlyPayLedger is not deployed on ${net}`);
    this.ledger = ledger; this.from = LEDGER_FROM_BLOCK[net];
    const transport = http(rpc ?? chain.rpcUrls.default.http[0], { timeout: 20000, retryCount: 1 });
    this.pub = createPublicClient({ chain, transport }) as PublicClient;
    this.wallet = createWalletClient({ account, chain, transport });
  }

  private async write(functionName: string, args: unknown[]) {
    const { request } = await this.pub.simulateContract({ account: this.account, address: this.ledger, abi: ledgerAbi, functionName: functionName as never, args: args as never });
    const hash = await this.wallet.writeContract(request as never);
    const receipt = await this.pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (receipt.status !== 'success') throw new Error(`${functionName} reverted`);
    return hash;
  }

  /** Contract error name ArcVault.pay would revert with, or null if it would succeed. */
  async checkPay(recipient: Hex, amount: bigint, paymentId: Hex): Promise<string | null> {
    try { await this.pub.simulateContract({ account: this.account, address: this.vault, abi: vaultAbi, functionName: 'pay', args: [recipient, amount, paymentId] }); return null; }
    catch (error) { const r = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined; return r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? 'Reverted' : 'RpcError'; }
  }

  /** Pays through the vault. Never retried: on a timeout, reconcile the hash before trying again. */
  async pay(recipient: Hex, amount: bigint, paymentId: Hex) {
    const refusal = await this.checkPay(recipient, amount, paymentId);
    if (refusal) { void this.notify(`ArcSteward EarlyPay: vault blocked a payment of ${usdc(amount)} USDC to ${recipient} (${refusal}).`); throw new Error(`Vault refused: ${refusal}`); }
    const { request } = await this.pub.simulateContract({ account: this.account, address: this.vault, abi: vaultAbi, functionName: 'pay', args: [recipient, amount, paymentId] });
    const hash = await this.wallet.writeContract(request);
    const receipt = await this.pub.waitForTransactionReceipt({ hash, timeout: 90_000 }).catch(() => { throw new Error(`Payment ${hash} submitted; receipt unavailable. Reconcile before retrying.`); });
    if (receipt.status !== 'success') throw new Error(`Payment ${hash} reverted`);
    return hash;
  }

  /** Offers with no decision yet, oldest first. */
  async pending() {
    const [offers, decisions] = await Promise.all([fetchOffers(this.pub, this.ledger, this.from, this.vault), fetchDecisions(this.pub, this.ledger, this.from, this.vault)]);
    const decided = new Set(decisions.map(d => d.offerHash.toLowerCase()));
    return { offers, decisions, open: offers.filter(o => !decided.has(o.offerHash.toLowerCase())) };
  }

  async decideOne(item: SubmittedOffer, all: SubmittedOffer[], settledInvoices: Set<string>, history: Map<string, bigint[]>): Promise<{ result: DecisionResult; facts: Awaited<ReturnType<typeof readFacts>> }> {
    const facts = await readFacts(this.pub, this.ledger, this.vault, this.account.address, item.offer, item.signature);
    const obligations = all.filter(o => !settledInvoices.has(o.offer.invoiceHash.toLowerCase())).map(o => ({ invoiceHash: o.offer.invoiceHash, face: o.offer.faceAmount, dueDate: Number(o.offer.dueDate) }));
    const result = await decide(item.offer, item.meta, facts, this.policy, obligations, { llm: this.llm, history: history.get(item.offer.supplier.toLowerCase()) ?? [] });
    return { result, facts };
  }

  private async record(item: SubmittedOffer, decision: DecisionResult['decision'], result: DecisionResult, extra: Record<string, unknown> = {}) {
    const prev = await this.pub.readContract({ address: this.ledger, abi: ledgerAbi, functionName: 'chainHead', args: [this.vault] }) as Hex;
    const inputs = inputsHash(result.context);
    const note = encodeNote({ reason: result.reason, source: result.source, overridden: result.overridden, inputs: { ...result.context, ...extra } });
    if (decision === 'PAY_EARLY') return this.write('recordPayEarly', [item.offer, item.signature, inputs, prev, note]);
    return this.write('recordDecision', [this.vault, item.offer.invoiceHash, item.offerHash, DECISIONS.indexOf(decision), inputs, prev, note]);
  }

  async runOnce(log: (r: RunResult) => void = r => console.log(JSON.stringify(r))) {
    const { offers, open } = await this.pending();
    const settlements = await fetchSettlements(this.pub, this.ledger, this.from, this.vault);
    const settled = new Set(settlements.map(s => s.invoiceHash.toLowerCase()));
    const history = new Map<string, bigint[]>();
    for (const s of settlements) { const o = offers.find(x => x.offer.invoiceHash.toLowerCase() === s.invoiceHash.toLowerCase()); if (o) { const k = o.offer.supplier.toLowerCase(); history.set(k, [...(history.get(k) ?? []), o.offer.faceAmount]); } }
    const results: RunResult[] = [];
    for (const item of open) {
      const base: RunResult = { offerHash: item.offerHash, invoice: item.meta.number, decision: '', reason: '', source: '' };
      try {
        const { result } = await this.decideOne(item, offers, settled, history);
        let decision = result.decision;
        const r: RunResult = { ...base, decision, reason: result.reason, source: result.source, overridden: result.overridden };
        if (decision === 'PAY_EARLY') {
          // The vault is the final authority: pre-check before recording, so a refusal becomes an escalation.
          const refusal = await this.checkPay(item.offer.payout, result.payoutUnits, item.offer.invoiceHash);
          if (refusal) { decision = 'ESCALATE'; r.decision = decision; r.reason = `Vault would refuse the payment (${refusal}); escalated to the owner. ${result.reason}`; result.reason = r.reason; }
        }
        r.decisionTx = await this.record(item, decision, result);
        if (decision === 'PAY_EARLY') {
          r.paymentTx = await this.pay(item.offer.payout, result.payoutUnits, item.offer.invoiceHash);
          r.settlementTx = await this.write('recordSettlement', [this.vault, item.offer.invoiceHash, item.offer.payout, result.payoutUnits, r.paymentTx]);
          settled.add(item.offer.invoiceHash.toLowerCase());
        }
        if (decision === 'ESCALATE' || decision === 'REJECT') await this.notify(`ArcSteward EarlyPay ${decision}: invoice ${item.meta.number ?? item.offer.invoiceHash.slice(0, 10)} from ${item.offer.supplier} for ${usdc(item.offer.faceAmount)} USDC. ${r.reason}`);
        results.push(r); log(r);
      } catch (e) {
        const r = { ...base, decision: 'ERROR', error: e instanceof Error ? e.message.slice(0, 300) : String(e) };
        results.push(r); log(r);
      }
    }
    return results;
  }
}

export function agentFromEnv(opts: { scripted?: boolean; notify?: (text: string) => Promise<unknown> } = {}) {
  const key = process.env.ARC_AGENT_PRIVATE_KEY;
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error('ARC_AGENT_PRIVATE_KEY missing');
  const vault = process.env.EARLYPAY_VAULT ?? process.env.ARC_VAULT_ADDRESS;
  if (!vault) throw new Error('EARLYPAY_VAULT missing');
  const net = (process.env.ARC_NETWORK ?? 'testnet') as 'testnet' | 'mainnet';
  if (net === 'mainnet' && process.env.ARC_MAINNET_CONFIRM !== 'I_CONFIRM_MAINNET_SPEND') throw new Error('Mainnet requires ARC_MAINNET_CONFIRM');
  return new EarlyPayAgent(privateKeyToAccount(key as Hex), vault as Hex, net, policyFromEnv(), opts.scripted ? undefined : llmFromEnv(), process.env.ARC_RPC_URL, opts.notify);
}

