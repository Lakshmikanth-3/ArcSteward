'use client';

import { useEffect, useMemo, useState } from 'react';
import { BaseError, ContractFunctionRevertedError, createPublicClient, createWalletClient, custom, erc20Abi, http, isAddress, getAddress, type EIP1193Provider, type Hex } from 'viem';
import { arcTestnet, USDC } from '@/lib/arc/config';
import { ledgerAbi, vaultAbi } from '@/lib/arc/abi';
import { LEDGER } from '@/lib/earlypay/ledger';
import { earlyPayout, discountAmount, daysEarly, usdc } from '@/lib/earlypay/math';
import { encodeNote, inputsHash } from '@/lib/earlypay/log';
import { DEFAULT_POLICY } from '@/lib/earlypay/types';
import { Shell, DEMO_VAULT, DEMO_AGENT, useEarlyPay, statusOf, DecisionTag, txUrl, addrUrl, short, fmt, type SOffer } from '@/components/earlypay/shared';

const ledger = LEDGER.testnet!;
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 700 }) });
const HUMAN_APPROVED = 4, REJECT = 3;
const revertName = (e: unknown) => { const r = e instanceof BaseError ? e.walk(x => x instanceof ContractFunctionRevertedError) : undefined; return r instanceof ContractFunctionRevertedError ? r.data?.errorName ?? 'Reverted' : undefined; };

export default function BuyerApp() {
  const [vaultInput, setVaultInput] = useState(DEMO_VAULT);
  const vault = isAddress(vaultInput) ? getAddress(vaultInput) : '';
  const [agentInput, setAgentInput] = useState(DEMO_AGENT);
  const agent = isAddress(agentInput) ? getAddress(agentInput) : undefined;
  const { state, error, reload } = useEarlyPay(vault, undefined, 6000);
  const [account, setAccount] = useState<Hex>();
  const [chainId, setChainId] = useState<number>();
  const [allowed, setAllowed] = useState<Record<string, boolean>>({});
  const [registered, setRegistered] = useState<Record<string, { payout: string; since: number }>>({});
  const [cap, setCap] = useState<{ maxPayment: bigint; maxPerDay: bigint; remaining: bigint; daily: bigint; expiresAt: number; active: boolean }>();
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: string; text: string }>({ kind: '', text: '' });
  const provider = () => (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  const isOwner = !!account && !!state?.owner && account.toLowerCase() === state.owner.toLowerCase();

  const supplierIds = useMemo(() => [...new Set((state?.offers ?? []).map(o => o.offer.supplier.toLowerCase()))], [state]);
  const payouts = useMemo(() => [...new Set((state?.offers ?? []).map(o => o.offer.payout.toLowerCase()))], [state]);

  useEffect(() => {
    if (!vault || !agent) return;
    void (async () => {
      const a: Record<string, boolean> = {};
      for (const p of payouts) a[p] = await pub.readContract({ address: vault, abi: vaultAbi, functionName: 'allowed', args: [agent, p as Hex] }) as boolean;
      setAllowed(a);
      const r: Record<string, { payout: string; since: number }> = {};
      for (const s of supplierIds) { const [payout, , since, reg] = await pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'suppliers', args: [s as Hex] }) as readonly [Hex, Hex, bigint, boolean]; if (reg) r[s] = { payout, since: Number(since) }; }
      setRegistered(r);
      const c = await pub.readContract({ address: vault, abi: vaultAbi, functionName: 'capabilities', args: [agent] }) as readonly unknown[];
      const daily = await pub.readContract({ address: vault, abi: vaultAbi, functionName: 'dailyRemaining', args: [agent] }) as bigint;
      setCap({ maxPayment: c[1] as bigint, maxPerDay: c[2] as bigint, remaining: (c[0] as bigint) - (c[4] as bigint), daily, expiresAt: Number(c[8]), active: c[10] as boolean });
    })().catch(() => {});
  }, [vault, agent, payouts, supplierIds, state]);

  const run = (label: string, fn: () => Promise<string | void>) => async () => {
    setBusy(label); setMsg({ kind: '', text: '' });
    try { const text = await fn(); if (text) setMsg({ kind: 'good', text }); await reload(); }
    catch (e) { setMsg({ kind: 'bad', text: revertName(e) ?? (e instanceof Error ? e.message.split('\n')[0] : String(e)) }); }
    finally { setBusy(''); }
  };
  const wallet = () => { const p = provider(); if (!p) throw new Error('Open this page in a browser with an EVM wallet (MetaMask, Rabby, Coinbase Wallet).'); return createWalletClient({ chain: arcTestnet, transport: custom(p) }); };
  const send = async (fn: (w: ReturnType<typeof wallet>, a: Hex) => Promise<Hex>) => {
    const w = wallet(); if (!account) throw new Error('Connect your wallet');
    if (await w.getChainId() !== arcTestnet.id) throw new Error('Switch your wallet to Arc Testnet');
    const hash = await fn(w, account); const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
    if (r.status !== 'success') throw new Error(`Transaction ${short(hash)} reverted`); return hash;
  };

  const connect = run('connect', async () => { const w = wallet(); const [a] = await w.requestAddresses(); setAccount(a); setChainId(await w.getChainId()); });
  const switchChain = run('switch', async () => { const w = wallet(); try { await w.switchChain({ id: arcTestnet.id }); } catch { await w.addChain({ chain: arcTestnet }); await w.switchChain({ id: arcTestnet.id }); } setChainId(arcTestnet.id); });
  const runAgent = run('agent', async () => {
    const res = await fetch('/api/earlypay/run', { method: 'POST' }); const out = await res.json();
    if (!res.ok) throw new Error(out.error); return out.results.length ? `Agent decided ${out.results.length} invoice(s): ${out.results.map((r: { invoice?: string; decision: string }) => `${r.invoice ?? '?'} → ${r.decision}`).join(', ')}` : 'Agent ran: no new invoices.';
  });

  const approveSupplier = (supplier: string, payout: string) => run(`approve:${payout}`, async () => {
    const reg = registered[supplier.toLowerCase()];
    if (!reg || reg.payout.toLowerCase() !== payout.toLowerCase()) throw new Error('This payout address is not the supplier\'s registered address. Not approving.');
    if (!agent) throw new Error('Agent address required');
    const tx = await send((w, a) => w.writeContract({ account: a, address: vault as Hex, abi: vaultAbi, functionName: 'setRecipient', args: [agent, payout as Hex, true] }));
    return `Supplier approved on the vault (two-key rule complete). Tx ${short(tx)}. Run the agent to re-decide.`;
  });

  const resolve = (o: SOffer, approve: boolean) => run(`${approve ? 'pay' : 'decline'}:${o.offerHash}`, async () => {
    const offer = { ...o.offer, faceAmount: BigInt(o.offer.faceAmount), dueDate: BigInt(o.offer.dueDate), expiry: BigInt(o.offer.expiry) } as never;
    const payout = earlyPayout(BigInt(o.offer.faceAmount), o.offer.discountBps);
    const prev = await pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'chainHead', args: [vault as Hex] }) as Hex;
    if (!approve) {
      const inputs = { invoiceHash: o.offer.invoiceHash, by: 'owner', action: 'declined escalation' };
      const tx = await send((w, a) => w.writeContract({ account: a, address: ledger, abi: ledgerAbi, functionName: 'recordDecision', args: [vault as Hex, o.offer.invoiceHash as Hex, o.offerHash as Hex, REJECT, inputsHash(inputs), prev, encodeNote({ reason: 'Owner declined the escalated invoice.', source: 'owner', inputs })] }));
      return `Declined and recorded. Tx ${short(tx)}`;
    }
    // Re-check the signed offer against the supplier registry before the owner signs anything.
    let check = 'ok';
    try { await pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'checkOffer', args: [offer, o.signature as Hex] }); } catch (e) { check = revertName(e) ?? 'RpcError'; }
    if (['PayoutMismatch', 'BadSignature', 'AlreadySettled', 'NotRegistered', 'InvalidInput', 'RpcError'].includes(check)) throw new Error(`Refusing to pay: ${check}. The payout address must match the supplier's registered address.`);
    if (check === 'PayoutCoolingDown' && !confirm('This supplier changed its payout address recently (cooldown still running). Pay anyway?')) return;
    if (check === 'OfferExpired' && !confirm('The supplier\'s early-pay offer has expired. Pay the discounted amount anyway?')) return;
    const payTx = await send((w, a) => w.writeContract({ account: a, address: USDC, abi: erc20Abi, functionName: 'transfer', args: [o.offer.payout as Hex, payout] }));
    const inputs = { invoiceHash: o.offer.invoiceHash, face: usdc(BigInt(o.offer.faceAmount)), discountBps: o.offer.discountBps, payout: usdc(payout), payoutAddress: o.offer.payout, check, by: 'owner' };
    const note = encodeNote({ reason: 'Owner reviewed the agent\'s escalation and paid from the owner wallet.', source: 'owner', inputs, payment: { tx: payTx, amount: usdc(payout), by: 'owner' } });
    await send((w, a) => w.writeContract({ account: a, address: ledger, abi: ledgerAbi, functionName: 'recordDecision', args: [vault as Hex, o.offer.invoiceHash as Hex, o.offerHash as Hex, HUMAN_APPROVED, inputsHash(inputs), prev, note] }));
    await send((w, a) => w.writeContract({ account: a, address: ledger, abi: ledgerAbi, functionName: 'recordSettlement', args: [vault as Hex, o.offer.invoiceHash as Hex, o.offer.payout as Hex, payout, payTx] }));
    return `Paid ${usdc(payout)} USDC from your wallet to the registered supplier and recorded HUMAN_APPROVED. Tx ${short(payTx)}`;
  });

  // Savings dashboard from chain events.
  const stats = useMemo(() => {
    const s = { invoices: 0, paidEarly: 0, paidUnits: 0n, discountUnits: 0n, daysSum: 0, escalations: 0, approved: 0, declined: 0, blocked: 0 };
    if (!state) return s;
    s.invoices = state.offers.length;
    for (const o of state.offers) {
      const { decisions, settled } = statusOf(state, o);
      if (decisions.some(d => d.decision === 'ESCALATE')) s.escalations++;
      if (decisions.some(d => d.decision === 'HUMAN_APPROVED')) s.approved++;
      if (decisions.some(d => d.decision === 'REJECT' && d.note?.source === 'owner')) s.declined++;
      if (decisions.some(d => d.decision === 'REJECT' && d.note?.source !== 'owner')) s.blocked++;
      if (settled) { s.paidEarly++; s.paidUnits += BigInt(settled.amount); s.discountUnits += discountAmount(BigInt(o.offer.faceAmount), o.offer.discountBps); const paidAt = decisions.find(d => d.decision === 'PAY_EARLY' || d.decision === 'HUMAN_APPROVED'); s.daysSum += paidAt?.note?.inputs?.daysEarly ? Number(paidAt.note.inputs.daysEarly) : daysEarly(Number(o.offer.dueDate), state.now); }
    }
    return s;
  }, [state]);

  const offers = [...(state?.offers ?? [])].reverse();
  const suppliers = supplierIds.map(id => ({ id, offer: state!.offers.find(o => o.offer.supplier.toLowerCase() === id)! }));
  return <Shell>
    <div className="page-head"><span className="k">Buyer · treasury owner</span><h1>Your agent pays early <em>only when it&apos;s worth it.</em></h1><p>Approve suppliers once, then let the treasury agent decide each invoice: pay early when the discount beats holding the cash, hold otherwise, and escalate anything unusual to you.</p></div>

    <div className="stats">
      <div className="stat"><b>{stats.paidEarly}</b><span>paid early of {stats.invoices}</span></div>
      <div className="stat"><b>{fmt(stats.paidUnits)}</b><span>USDC paid early</span></div>
      <div className="stat"><b>{fmt(stats.discountUnits)}</b><span>USDC discount captured</span></div>
      <div className="stat"><b>{stats.paidEarly ? Math.round(stats.daysSum / stats.paidEarly) : 0}</b><span>avg days early</span></div>
    </div>

    <section className="card">
      <h2><span className="step">I</span> Vault and agent</h2>
      <div className="grid2">
        <label className="field">Vault (Arc testnet)<input value={vaultInput} onChange={e => setVaultInput(e.target.value.trim())} spellCheck={false} /></label>
        <label className="field">Treasury agent address<input value={agentInput} onChange={e => setAgentInput(e.target.value.trim())} spellCheck={false} /></label>
      </div>
      {error && <div className="notice bad">{error}</div>}
      <dl className="kv">
        <dt>Owner</dt><dd className="mono">{state?.owner ? <a className="tx" href={addrUrl(state.owner)} target="_blank" rel="noreferrer">{state.owner}</a> : '—'}</dd>
        <dt>Vault balance</dt><dd>{fmt(state?.balance)} USDC</dd>
        <dt>Agent limits (on-chain)</dt><dd>{cap ? `${fmt(cap.maxPayment)} per payment · ${fmt(cap.daily)} of ${fmt(cap.maxPerDay)} left today · ${fmt(cap.remaining)} left in total · ${cap.active ? `expires ${new Date(cap.expiresAt * 1000).toISOString().slice(0, 10)}` : 'revoked'}` : '—'}</dd>
        <dt>Decision policy</dt><dd>Pay early if discount APR ≥ hold yield {DEFAULT_POLICY.holdYieldBps / 100}% (<b>simulated reserve rate</b>; USYC is not on Arc testnet) + {DEFAULT_POLICY.hurdleMarginBps / 100}% margin, and ≥ {usdc(DEFAULT_POLICY.liquidityBuffer)} USDC stays after 30-day obligations.</dd>
        <dt>Decision log</dt><dd className={state?.chain.valid ? 'chain-ok' : 'chain-bad'}>{state ? (state.chain.valid ? `✓ ${state.decisions.length} decisions, hash chain verified` : `✕ broken at #${state.chain.brokenAt}`) : '—'}</dd>
      </dl>
      <div className="row-actions">
        {!account ? <button className="btn" disabled={!!busy} onClick={connect}>Connect owner wallet</button> : <span className="tag">{short(account)} {isOwner ? '· owner' : '· not the owner'}</span>}
        {account && chainId !== arcTestnet.id && <button className="btn ghost" onClick={switchChain}>Switch to Arc Testnet</button>}
        <button className="btn ghost" disabled={!!busy} onClick={runAgent}>{busy === 'agent' ? 'Agent deciding…' : 'Run the agent now'}</button>
      </div>
    </section>

    {msg.text && <div className={`notice ${msg.kind}`} role="status">{msg.text}</div>}

    <section className="card">
      <h2><span className="step">II</span> Suppliers · two-key rule</h2>
      <p>A supplier signs its own payout address (key 1). You approve that address on the vault (key 2). A &quot;bank details changed&quot; attacker would need both keys.</p>
      {!suppliers.length && <p className="muted">No suppliers have sent invoices to this vault yet. Share <span className="mono">/earlypay/supplier?vault={short(vault)}</span>.</p>}
      <div className="list">{suppliers.map(({ id, offer }) => {
        const reg = registered[id]; const ok = reg && allowed[reg.payout.toLowerCase()];
        return <article className="item" key={id}>
          <div className="item-top"><h3>{offer.meta.supplierName ?? short(id)}</h3>{ok ? <span className="tag paid">APPROVED</span> : <span className="tag ESCALATE">NOT APPROVED</span>}</div>
          <span className="muted">Identity {short(id)} · registered payout <span className="mono">{reg?.payout ?? 'not registered'}</span></span>
          {!ok && reg && <div className="row-actions"><button className="btn small" disabled={!isOwner || !!busy} onClick={approveSupplier(id, reg.payout)}>{busy === `approve:${reg.payout}` ? 'Approving…' : 'Approve supplier'}</button>{!isOwner && <span className="muted">Connect the vault owner wallet to approve.</span>}</div>}
        </article>;
      })}</div>
    </section>

    <section className="card">
      <h2><span className="step">III</span> Invoice queue</h2>
      {!offers.length && <p className="muted">No invoices yet.</p>}
      <div className="list">{offers.map(o => {
        const { latest, settled } = statusOf(state, o);
        const face = BigInt(o.offer.faceAmount), payout = earlyPayout(face, o.offer.discountBps);
        const canResolve = latest?.decision === 'ESCALATE' && !settled;
        return <article className="item" key={o.offerHash}>
          <div className="item-top"><h3>{o.meta.number ?? short(o.offer.invoiceHash)} · {o.meta.supplierName ?? short(o.offer.supplier)}</h3><DecisionTag d={latest?.decision} settled={!!settled} /></div>
          <span className="muted">{usdc(face)} USDC · {o.offer.discountBps / 100}% discount → {usdc(payout)} USDC now · due {new Date(Number(o.offer.dueDate) * 1000).toISOString().slice(0, 10)}</span>
          {o.meta.description && <span className="muted">“{o.meta.description}”</span>}
          {latest?.note && <p className="reason"><b>{latest.note.source === 'owner' ? 'Owner' : 'Agent'}:</b> {latest.note.reason}{latest.note.overridden ? ` (${latest.note.overridden})` : ''}</p>}
          {latest?.note?.inputs && Array.isArray((latest.note.inputs as { flags?: unknown[] }).flags) && ((latest.note.inputs as { flags: { code: string; detail: string }[] }).flags).length > 0 && <span className="muted">Flags: {((latest.note.inputs as { flags: { code: string }[] }).flags).map(f => f.code).join(', ')}</span>}
          {settled && <span>Paid {fmt(settled.amount)} USDC · <a className="tx" href={txUrl(settled.paymentTx)} target="_blank" rel="noreferrer">payment ↗</a></span>}
          {canResolve && <div className="row-actions">
            <button className="btn small" disabled={!isOwner || !!busy} onClick={resolve(o, true)}>{busy === `pay:${o.offerHash}` ? 'Paying…' : `Approve & pay ${usdc(payout)} USDC myself`}</button>
            <button className="btn small danger" disabled={!isOwner || !!busy} onClick={resolve(o, false)}>Decline</button>
            {!isOwner && <span className="muted">Owner wallet required.</span>}
          </div>}
        </article>;
      })}</div>
    </section>

    <section className="card">
      <h2><span className="step">IV</span> Human review</h2>
      <dl className="kv"><dt>Escalated by the agent</dt><dd>{stats.escalations}</dd><dt>Approved by you</dt><dd>{stats.approved}</dd><dt>Declined by you</dt><dd>{stats.declined}</dd><dt>Blocked automatically (REJECT)</dt><dd>{stats.blocked}</dd></dl>
    </section>
  </Shell>;
}
