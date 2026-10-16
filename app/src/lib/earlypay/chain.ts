// Reads EarlyPay state from Arc: offers, decisions, settlements and the live facts
// the agent needs. Everything comes from contract events and views; no database.
import { BaseError, ContractFunctionRevertedError, parseEventLogs, type PublicClient, type Log } from 'viem';
import { ledgerAbi, vaultAbi } from '../arc/abi';
import type { ChainFacts, Decision, Hex, Offer, OfferMeta } from './types';
import { DECISIONS } from './types';
import { decodeNote, type DecisionNote, type ChainRecord } from './log';

type Pub = PublicClient;
const CHUNK = 9_000n; // Arc RPCs reject eth_getLogs ranges of 10,000 blocks or more
type Decoded = Log & { eventName: string; args: Record<string, unknown>; transactionHash: Hex; blockNumber: bigint };

// Incremental cache of every ledger event: each call only fetches blocks it has not seen.
const cache = new Map<string, { next: bigint; events: Decoded[]; pending?: Promise<void> }>();

async function ledgerEvents(pub: Pub, ledger: Hex, fromBlock: bigint): Promise<Decoded[]> {
  const id = `${pub.chain?.id ?? 'x'}:${ledger.toLowerCase()}:${fromBlock}`;
  let c = cache.get(id);
  if (!c) { c = { next: fromBlock, events: [] }; cache.set(id, c); }
  if (c.pending) await c.pending;
  const entry = c;
  entry.pending = (async () => {
    const latest = await pub.getBlockNumber();
    for (let from = entry.next; from <= latest; from += CHUNK) {
      const to = from + CHUNK - 1n > latest ? latest : from + CHUNK - 1n;
      const raw = await pub.getLogs({ address: ledger, fromBlock: from, toBlock: to });
      entry.events.push(...parseEventLogs({ abi: ledgerAbi, logs: raw }) as unknown as Decoded[]);
      entry.next = to + 1n;
    }
  })();
  try { await entry.pending; } finally { entry.pending = undefined; }
  return entry.events;
}

async function logs(pub: Pub, address: Hex, fromBlock: bigint, eventName: string, args?: Record<string, unknown>) {
  const all = await ledgerEvents(pub, address, fromBlock);
  return all.filter(e => e.eventName === eventName && (!args || Object.entries(args).every(([k, v]) => String(e.args[k]).toLowerCase() === String(v).toLowerCase())));
}

export type SubmittedOffer = { offer: Offer; signature: Hex; offerHash: Hex; meta: OfferMeta; rawMeta: string; tx: Hex; block: bigint };

export function parseMeta(raw: string): OfferMeta {
  try { const m = JSON.parse(raw) as Record<string, unknown>; const s = (k: string) => typeof m[k] === 'string' ? (m[k] as string).slice(0, 2000) : undefined; return { number: s('number'), description: s('description'), notes: s('notes'), supplierName: s('supplierName'), currency: s('currency') }; }
  catch { return { notes: raw.slice(0, 2000) }; }
}

export async function fetchOffers(pub: Pub, ledger: Hex, fromBlock: bigint, vault?: Hex): Promise<SubmittedOffer[]> {
  const ev = await logs(pub, ledger, fromBlock, 'OfferSubmitted', vault ? { vault } : undefined);
  return ev.map(l => {
    const o = l.args.offer as Offer & { discountBps: number | bigint };
    return { offer: { ...o, discountBps: Number(o.discountBps) }, signature: l.args.signature as Hex, offerHash: l.args.offerHash as Hex, rawMeta: l.args.meta as string, meta: parseMeta(l.args.meta as string), tx: l.transactionHash, block: l.blockNumber };
  });
}

export type DecisionEntry = ChainRecord & { recorder: Hex; tx: Hex; block: bigint; note?: DecisionNote; rawNote: string };

export async function fetchDecisions(pub: Pub, ledger: Hex, fromBlock: bigint, vault: Hex): Promise<DecisionEntry[]> {
  const [recorded, notes] = await Promise.all([logs(pub, ledger, fromBlock, 'DecisionRecorded', { vault }), logs(pub, ledger, fromBlock, 'DecisionNote', { vault })]);
  const noteOf = new Map(notes.map(n => [n.args.decisionHash as string, n.args.note as string]));
  return recorded.map(l => {
    const raw = noteOf.get(l.args.decisionHash as string) ?? '';
    return {
      vault, invoiceHash: l.args.invoiceHash as Hex, offerHash: l.args.offerHash as Hex, decision: DECISIONS[Number(l.args.decision)] as Decision,
      inputsHash: l.args.inputsHash as Hex, prevHash: l.args.prevHash as Hex, decisionHash: l.args.decisionHash as Hex,
      recorder: l.args.recorder as Hex, tx: l.transactionHash, block: l.blockNumber, rawNote: raw, note: decodeNote(raw),
    };
  });
}

export type Settlement = { invoiceHash: Hex; payout: Hex; amount: bigint; paymentTx: Hex; recorder: Hex; tx: Hex };
export async function fetchSettlements(pub: Pub, ledger: Hex, fromBlock: bigint, vault?: Hex): Promise<Settlement[]> {
  return (await logs(pub, ledger, fromBlock, 'Settled', vault ? { vault } : undefined)).map(l => ({ invoiceHash: l.args.invoiceHash as Hex, payout: l.args.payout as Hex, amount: l.args.amount as bigint, paymentTx: l.args.paymentTx as Hex, recorder: l.args.recorder as Hex, tx: l.transactionHash }));
}

export async function fetchSuppliers(pub: Pub, ledger: Hex, fromBlock: bigint) {
  return (await logs(pub, ledger, fromBlock, 'SupplierRegistered')).map(l => ({ supplier: l.args.supplier as Hex, payout: l.args.payout as Hex, changed: l.args.payoutChanged as boolean, block: l.blockNumber, tx: l.transactionHash }));
}

/** The contract error name checkOffer would revert with, or 'ok'. */
export async function checkOffer(pub: Pub, ledger: Hex, offer: Offer, signature: Hex): Promise<string> {
  try { await pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'checkOffer', args: [offer, signature] }); return 'ok'; }
  catch (error) {
    const r = error instanceof BaseError ? error.walk(e => e instanceof ContractFunctionRevertedError) : undefined;
    return r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? 'Reverted' : 'RpcError';
  }
}

export async function readFacts(pub: Pub, ledger: Hex, vault: Hex, agent: Hex, offer: Offer, signature: Hex): Promise<ChainFacts> {
  const [block, offerCheck, supplier, allowed, used, cap, balance, dailyRemaining] = await Promise.all([
    pub.getBlock(),
    checkOffer(pub, ledger, offer, signature),
    pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'suppliers', args: [offer.supplier] }),
    pub.readContract({ address: vault, abi: vaultAbi, functionName: 'allowed', args: [agent, offer.payout] }),
    pub.readContract({ address: vault, abi: vaultAbi, functionName: 'usedPaymentIds', args: [agent, offer.invoiceHash] }),
    pub.readContract({ address: vault, abi: vaultAbi, functionName: 'capabilities', args: [agent] }),
    pub.readContract({ address: vault, abi: vaultAbi, functionName: 'balance' }),
    pub.readContract({ address: vault, abi: vaultAbi, functionName: 'dailyRemaining', args: [agent] }),
  ]);
  const [maxTotal, maxPayment, , , spent, , , , expiresAt, , active] = cap as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean];
  const now = Number(block.timestamp);
  const [regPayout, , , registered] = supplier as readonly [Hex, Hex, bigint, boolean];
  return {
    now, offerCheck, registeredPayout: registered ? regPayout : undefined,
    vaultAllowsPayout: allowed as boolean, invoiceUsedInVault: used as boolean, vaultBalance: balance as bigint,
    maxPayment, remainingBudget: maxTotal > spent ? maxTotal - spent : 0n, dailyRemaining: dailyRemaining as bigint,
    agentActive: active && now < Number(expiresAt),
  };
}
