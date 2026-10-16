'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createPublicClient, http, isAddress, getAddress, keccak256, toHex, parseUnits, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { arcTestnet } from '@/lib/arc/config';
import { ledgerAbi } from '@/lib/arc/abi';
import { LEDGER, PAYOUT_COOLDOWN_SECONDS, domain, offerTypes, registrationTypes } from '@/lib/earlypay/ledger';
import { daysEarly, discountAprBps, earlyPayout, discountAmount, usdc, pct } from '@/lib/earlypay/math';
import { canonical } from '@/lib/earlypay/log';
import { Shell, DEMO_VAULT, useEarlyPay, statusOf, DecisionTag, txUrl, short, fmt } from '@/components/earlypay/shared';

const KEY = 'arcsteward.earlypay.supplierKey';
const PROFILE = 'arcsteward.earlypay.profile';
const ledger = LEDGER.testnet!;
const pub = createPublicClient({ chain: arcTestnet, transport: http(undefined, { retryCount: 5, retryDelay: 700 }) });
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } } };

export default function SupplierApp() {
  const params = useSearchParams();
  const vault = (params.get('vault') && isAddress(params.get('vault')!) ? getAddress(params.get('vault')!) : DEMO_VAULT) as Hex;
  const buyerName = params.get('buyer') ?? 'the buyer';
  const [key, setKey] = useState<Hex>();
  const account = useMemo(() => (key ? privateKeyToAccount(key) : undefined), [key]);
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [payoutMode, setPayoutMode] = useState<'own' | 'browser'>('own');
  const [payoutInput, setPayoutInput] = useState('');
  const [reg, setReg] = useState<{ payout: Hex; since: number; registered: boolean }>();
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState<{ kind: 'good' | 'bad' | ''; text: string }>({ kind: '', text: '' });
  const [inv, setInv] = useState({ number: '', amount: '', due: '', discount: '2', description: '', notes: '' });
  const [paste, setPaste] = useState('');
  const [extractWarn, setExtractWarn] = useState('');
  const [showKey, setShowKey] = useState(false);
  const { state, reload } = useEarlyPay(vault, account?.address, 5000);

  useEffect(() => {
    // Browser-only state (localStorage) is loaded after hydration.
    const init = setTimeout(() => {
      let k = store.get(KEY) as Hex | null;
      if (!k || !/^0x[0-9a-fA-F]{64}$/.test(k)) { k = generatePrivateKey(); store.set(KEY, k); }
      setKey(k);
      try { const p = JSON.parse(store.get(PROFILE) ?? '{}'); setName(p.name ?? ''); setContact(p.contact ?? ''); if (p.payout) setPayoutInput(p.payout); if (p.mode) setPayoutMode(p.mode); } catch { /* none */ }
    }, 0);
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => { clearTimeout(init); clearInterval(t); };
  }, []);

  const readReg = async (addr: Hex) => {
    const [payout, , since, registered] = await pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'suppliers', args: [addr] }) as readonly [Hex, Hex, bigint, boolean];
    setReg({ payout, since: Number(since), registered });
  };
  useEffect(() => { if (!account) return; const t = setTimeout(() => void readReg(account.address), 0); return () => clearTimeout(t); }, [account]);

  const payout = payoutMode === 'browser' ? account?.address : (isAddress(payoutInput) ? getAddress(payoutInput) : undefined);
  const readyAt = reg ? reg.since + PAYOUT_COOLDOWN_SECONDS : 0;
  const coolingDown = !!reg?.registered && now < readyAt;
  const relay = async (body: unknown) => {
    const res = await fetch('/api/earlypay/relay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body, (_, v) => typeof v === 'bigint' ? v.toString() : v) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error ?? 'Relay failed');
    return out as { tx: Hex; agentQueued?: boolean };
  };
  const run = (label: string, fn: () => Promise<void>) => async () => {
    setBusy(label); setMsg({ kind: '', text: '' });
    try { await fn(); } catch (e) { setMsg({ kind: 'bad', text: e instanceof Error ? e.message : String(e) }); } finally { setBusy(''); }
  };

  const register = run('register', async () => {
    if (!account) return;
    if (!name.trim()) throw new Error('Enter your name or business name.');
    if (!payout) throw new Error('Enter a valid wallet address (0x…) or choose "receive in this browser".');
    store.set(PROFILE, JSON.stringify({ name, contact, payout: payoutInput, mode: payoutMode }));
    const profileHash = keccak256(toHex(canonical({ name: name.trim(), contact: contact.trim() })));
    const nonce = await pub.readContract({ address: ledger, abi: ledgerAbi, functionName: 'nonces', args: [account.address] }) as bigint;
    const signature = await account.signTypedData({ domain: domain(arcTestnet.id, ledger), types: registrationTypes, primaryType: 'Registration', message: { supplier: account.address, payout, profileHash, nonce } });
    const { tx } = await relay({ kind: 'register', supplier: account.address, payout, profileHash, signature });
    await readReg(account.address);
    setMsg({ kind: 'good', text: `Registered. Your payout address is locked to ${short(payout)}; it becomes payable after a ${Math.round(PAYOUT_COOLDOWN_SECONDS / 60)}-minute safety cooldown. Tx ${short(tx)}` });
  });

  const days = inv.due ? daysEarly(Math.floor(new Date(inv.due + 'T12:00:00Z').getTime() / 1000), now) : 0;
  const bps = Math.round(Number(inv.discount || 0) * 100);
  const face = (() => { try { return inv.amount ? parseUnits(inv.amount, 6) : 0n; } catch { return 0n; } })();

  const submit = run('submit', async () => {
    if (!account || !reg?.registered) throw new Error('Register first.');
    if (!inv.number.trim()) throw new Error('Add an invoice number.');
    if (face <= 0n) throw new Error('Enter the invoice amount in USDC.');
    if (!inv.due || days <= 0) throw new Error('Choose a due date in the future.');
    if (bps < 0 || bps > 5000) throw new Error('Discount must be between 0% and 50%.');
    const t = now;
    const offer = { vault, supplier: account.address, invoiceHash: keccak256(toHex(`${vault}|${account.address}|${inv.number.trim()}`.toLowerCase())), faceAmount: face, discountBps: bps, payout: reg.payout, dueDate: BigInt(Math.floor(new Date(inv.due + 'T12:00:00Z').getTime() / 1000)), expiry: BigInt(t + 7 * 86400) };
    const signature = await account.signTypedData({ domain: domain(arcTestnet.id, ledger), types: offerTypes, primaryType: 'Offer', message: offer });
    const meta = JSON.stringify({ number: inv.number.trim(), description: inv.description.trim() || undefined, notes: inv.notes.trim() || undefined, supplierName: name.trim() || undefined, currency: 'USDC' });
    const { tx, agentQueued } = await relay({ kind: 'offer', offer, signature, meta });
    void fetch('/api/earlypay/run', { method: 'POST' }).then(() => reload()).catch(() => {});
    setMsg({ kind: 'good', text: `Invoice ${inv.number} sent to ${buyerName}'s treasury agent${agentQueued ? ', which is deciding now' : ''}. Tx ${short(tx)}` });
    setInv({ number: '', amount: '', due: '', discount: inv.discount, description: '', notes: '' });
    setTimeout(reload, 1500);
  });

  const extract = run('extract', async () => {
    const res = await fetch('/api/earlypay/extract', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: paste }) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error);
    const f = out.fields as { number?: string; amount?: number; dueDate?: string; description?: string; payoutAddress?: string };
    setInv(v => ({ ...v, number: f.number ?? v.number, amount: f.amount ? String(f.amount) : v.amount, due: f.dueDate ?? v.due, description: f.description ?? v.description }));
    setExtractWarn(f.payoutAddress && reg?.registered && f.payoutAddress.toLowerCase() !== reg.payout.toLowerCase()
      ? `Warning: the invoice text names payout address ${f.payoutAddress}, which is not your registered address ${reg.payout}. The offer will use your registered address. If someone sent you this invoice to forward, it may be a payment-redirection attempt.`
      : '');
  });

  const mine = state?.offers ?? [];
  // While any of this supplier's invoices awaits a decision (e.g. during the payout cooldown), nudge the agent.
  const waiting = mine.some(o => !statusOf(state, o).latest);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { void fetch('/api/earlypay/run', { method: 'POST' }).then(() => reload()).catch(() => {}); }, 20000);
    return () => clearInterval(t);
  }, [waiting, reload]);
  return <Shell>
    <div className="page-head"><span className="k">Supplier · about 2 minutes</span><h1>Get paid <em>this week,</em> not in 60 days.</h1><p>Register once, send your invoice and offer a small discount for early payment. {buyerName === 'the buyer' ? 'The buyer' : buyerName}&apos;s AI treasury agent decides in seconds and pays you in USDC on Arc. No gas, no app to install.</p></div>

    <section className="card">
      <h2><span className="step">I</span> Register your payout address</h2>
      {reg?.registered
        ? <><div className={`notice ${coolingDown ? '' : 'good'}`}>Registered as <b>{name || short(account?.address)}</b>. Payouts go to <span className="mono">{reg.payout}</span>. {coolingDown ? <>Safety cooldown: payable in <b>{Math.max(0, readyAt - now)}s</b>. You can send your invoice now.</> : 'Ready to receive early payments.'}</div><p className="muted" style={{ marginTop: 10 }}>Changing this address later restarts the cooldown. That stops anyone who fakes a &quot;bank details changed&quot; email from redirecting your money.</p></>
        : <>
          <div className="grid2">
            <label className="field">Your name or business<input value={name} onChange={e => setName(e.target.value)} placeholder="Asha Design Studio" autoComplete="organization" /></label>
            <label className="field">Email or phone (optional, kept off-chain as a hash)<input value={contact} onChange={e => setContact(e.target.value)} placeholder="asha@example.com" /></label>
          </div>
          <label className="field">Where should USDC be paid?
            <select value={payoutMode} onChange={e => setPayoutMode(e.target.value as 'own' | 'browser')}><option value="own">My wallet address (MetaMask, Coinbase, Rabby…)</option><option value="browser">I don&apos;t have a wallet: keep it in this browser</option></select>
          </label>
          {payoutMode === 'own' && <label className="field">Wallet address<input value={payoutInput} onChange={e => setPayoutInput(e.target.value.trim())} placeholder="0x…" inputMode="text" autoCapitalize="off" spellCheck={false} /></label>}
          {payoutMode === 'browser' && <div className="notice">USDC will arrive at <span className="mono">{account?.address}</span>, held by a key in this browser. Back it up below before clearing your browser data.</div>}
          <div className="row-actions"><button className="btn" disabled={!!busy} onClick={register}>{busy === 'register' ? 'Registering…' : 'Sign & register (free)'}</button></div>
        </>}
      <details><summary>Your signing identity · {short(account?.address)}</summary>
        <p className="muted" style={{ marginTop: 8 }}>This key in your browser signs your registration and invoices. Nobody else can change your payout address.</p>
        <button className="btn small ghost" onClick={() => setShowKey(!showKey)}>{showKey ? 'Hide key' : 'Show backup key'}</button>
        {showKey && <pre className="note">{key}</pre>}
      </details>
    </section>

    <section className="card" style={{ opacity: reg?.registered ? 1 : .55 }}>
      <h2><span className="step">II</span> Send an invoice</h2>
      <details><summary>Paste invoice text to fill the form (AI)</summary>
        <label className="field">Invoice text<textarea value={paste} onChange={e => setPaste(e.target.value)} placeholder="Paste the text of your invoice or email" /></label>
        <button className="btn small ghost" disabled={!paste || !!busy} onClick={extract}>{busy === 'extract' ? 'Reading…' : 'Fill from text'}</button>
      </details>
      {extractWarn && <div className="notice bad">{extractWarn}</div>}
      <div className="grid2">
        <label className="field">Invoice number<input value={inv.number} onChange={e => setInv({ ...inv, number: e.target.value })} placeholder="INV-1042" /></label>
        <label className="field">Amount (USDC)<input value={inv.amount} onChange={e => setInv({ ...inv, amount: e.target.value.replace(/[^0-9.]/g, '') })} placeholder="1.00" inputMode="decimal" /></label>
        <label className="field">Due date<input type="date" value={inv.due} onChange={e => setInv({ ...inv, due: e.target.value })} /></label>
        <label className="field">Discount for paying today (%)<input value={inv.discount} onChange={e => setInv({ ...inv, discount: e.target.value.replace(/[^0-9.]/g, '') })} inputMode="decimal" /></label>
      </div>
      <label className="field">What is it for?<input value={inv.description} onChange={e => setInv({ ...inv, description: e.target.value })} placeholder="Logo design, 2 revisions" /></label>
      <label className="field">Notes (optional)<input value={inv.notes} onChange={e => setInv({ ...inv, notes: e.target.value })} /></label>
      {face > 0n && days > 0 && <div className="calc"><span>Paid today: <b>{usdc(earlyPayout(face, bps))} USDC</b> instead of {usdc(face)} USDC in {days} days.</span><span>You give {usdc(discountAmount(face, bps))} USDC ({pct(bps)}); for the buyer that is {pct(discountAprBps(bps, days))} a year, which is what the agent weighs.</span></div>}
      <div className="row-actions"><button className="btn" disabled={!!busy || !reg?.registered} onClick={submit}>{busy === 'submit' ? 'Sending…' : 'Sign & send to the treasury agent'}</button></div>
      <p className="muted" style={{ marginTop: 10 }}>Buyer vault <span className="mono">{short(vault)}</span> · offer valid 7 days · you sign the exact amount, discount and payout address, so nobody can change them.</p>
    </section>

    {msg.text && <div className={`notice ${msg.kind}`} role="status">{msg.text}</div>}

    <section className="card">
      <h2><span className="step">III</span> Your invoices</h2>
      {!mine.length && <p className="muted">Nothing sent yet.</p>}
      <div className="list">{[...mine].reverse().map(o => {
        const { latest, settled } = statusOf(state, o);
        return <article className="item" key={o.offerHash}>
          <div className="item-top"><h3>{o.meta.number ?? short(o.offer.invoiceHash)}</h3><DecisionTag d={latest?.decision} settled={!!settled} /></div>
          <span className="muted">{fmt(o.offer.faceAmount)} USDC · {o.offer.discountBps / 100}% early-pay discount · due {new Date(Number(o.offer.dueDate) * 1000).toISOString().slice(0, 10)}</span>
          {latest?.note?.reason && <p className="reason">Agent: {latest.note.reason}</p>}
          {settled && <p className="reason">Paid <b>{fmt(settled.amount)} USDC</b> to {short(settled.payout)} · <a className="tx" href={txUrl(settled.paymentTx)} target="_blank" rel="noreferrer">payment on Arc ↗</a></p>}
          <a className="tx" href={txUrl(o.tx)} target="_blank" rel="noreferrer">signed offer on Arc ↗</a>
        </article>;
      })}</div>
    </section>
  </Shell>;
}
