'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { isAddress, getAddress, zeroHash, type Hex } from 'viem';
import { verifyChain, inputsHash, decisionHash } from '@/lib/earlypay/log';
import type { Decision } from '@/lib/earlypay/types';
import { Shell, DEMO_VAULT, useEarlyPay, txUrl, short, fmt } from '@/components/earlypay/shared';

export default function AuditApp() {
  const params = useSearchParams();
  const [vaultInput, setVaultInput] = useState(params.get('vault') ?? DEMO_VAULT);
  const [filter, setFilter] = useState(params.get('invoice') ?? '');
  const vault = isAddress(vaultInput) ? getAddress(vaultInput) : '';
  const { state, error } = useEarlyPay(vault, undefined, 15000);

  // Recomputed here, in the browser, from the raw on-chain records.
  const checks = useMemo(() => {
    if (!state) return undefined;
    const records = state.decisions.map(d => ({ ...d, vault: d.vault as Hex, invoiceHash: d.invoiceHash as Hex, offerHash: d.offerHash as Hex, decision: d.decision as Decision, inputsHash: d.inputsHash as Hex, prevHash: d.prevHash as Hex, decisionHash: d.decisionHash as Hex }));
    const chain = verifyChain(records);
    const per = records.map((r, i) => ({
      link: r.prevHash === (i === 0 ? zeroHash : records[i - 1].decisionHash),
      hash: decisionHash(r.vault, r.invoiceHash, r.offerHash, r.decision, r.inputsHash, r.prevHash, BigInt(i)) === r.decisionHash,
      inputs: state.decisions[i].note ? inputsHash(state.decisions[i].note!.inputs) === r.inputsHash : false,
    }));
    return { chain, per };
  }, [state]);

  const meta = (invoiceHash: string) => state?.offers.find(o => o.offer.invoiceHash.toLowerCase() === invoiceHash.toLowerCase());
  const settle = (invoiceHash: string) => state?.settlements.find(s => s.invoiceHash.toLowerCase() === invoiceHash.toLowerCase());
  const rows = (state?.decisions ?? []).map((d, i) => ({ d, i })).filter(({ d }) => !filter || d.invoiceHash.toLowerCase().includes(filter.toLowerCase()) || (meta(d.invoiceHash)?.meta.number ?? '').toLowerCase().includes(filter.toLowerCase()));

  return <Shell>
    <div className="page-head"><span className="k">Audit · replay every decision</span><h1>Every decision, <em>on the record.</em></h1><p>Each decision the agent (or owner) makes is written to EarlyPayLedger on Arc with the numbers it saw and its reason. Each entry commits to the one before it, so nothing can be edited or removed without breaking the chain. This page recomputes the chain in your browser.</p></div>
    <section className="card">
      <div className="grid2">
        <label className="field">Vault<input value={vaultInput} onChange={e => setVaultInput(e.target.value.trim())} spellCheck={false} /></label>
        <label className="field">Filter by invoice number or hash<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="INV-1042" /></label>
      </div>
      {error && <div className="notice bad">{error}</div>}
      {checks && <div className={`notice ${checks.chain.valid ? 'good' : 'bad'}`}>{checks.chain.valid ? `✓ Hash chain verified in your browser: ${state!.decisions.length} decisions, every link and every hash recomputed. Ledger ${short(state!.ledger)}.` : `✕ Chain broken at decision #${checks.chain.brokenAt}: ${checks.chain.why}`}</div>}
    </section>
    <section className="card">
      <h2>Decision log</h2>
      {!rows.length && <p className="muted">No decisions yet.</p>}
      <div className="list">{rows.map(({ d, i }) => {
        const m = meta(d.invoiceHash), s = settle(d.invoiceHash), c = checks?.per[i], inp = d.note?.inputs as Record<string, unknown> | undefined;
        return <article className="item" key={d.decisionHash}>
          <div className="item-top"><h3>#{i} · {m?.meta.number ?? short(d.invoiceHash)}</h3><span className={`tag ${d.decision}`}>{d.decision.replace('_', ' ')}</span></div>
          <p className="reason"><b>{d.note?.source === 'owner' ? 'Owner' : d.note?.source?.startsWith('llm') ? `Agent (${d.note.source.slice(4)})` : 'Agent (policy)'}:</b> {d.note?.reason ?? '(no note)'}</p>
          {inp && 'discountAprBps' in inp && <span className="muted">{String(inp.face)} USDC · {Number(inp.discountBps) / 100}% for {String(inp.daysEarly)} days early = {Number(inp.discountAprBps) / 100}% APR vs {Number(inp.hurdleAprBps) / 100}% hurdle ({String(inp.holdYieldSource)} hold yield) · runway after {String(inp.runwayAfter)} USDC</span>}
          {d.note?.overridden && <span className="muted">Guardrail: {d.note.overridden}</span>}
          {s && <span>Settled {fmt(s.amount)} USDC to {short(s.payout)} · <a className="tx" href={txUrl(s.paymentTx)} target="_blank" rel="noreferrer">payment ↗</a></span>}
          <dl className="kv">
            <dt>Decision hash</dt><dd className="mono">{d.decisionHash} {c && (c.hash ? '✓' : '✕')}</dd>
            <dt>Previous</dt><dd className="mono">{d.prevHash === zeroHash ? 'genesis' : d.prevHash} {c && (c.link ? '✓ linked' : '✕')}</dd>
            <dt>Inputs hash</dt><dd className="mono">{d.inputsHash} {c && (c.inputs ? '✓ matches the note' : '— not reproducible')}</dd>
            <dt>Recorded by</dt><dd className="mono">{d.recorder} · <a className="tx" href={txUrl(d.tx)} target="_blank" rel="noreferrer">tx ↗</a></dd>
          </dl>
          <details><summary>Raw note</summary><pre className="note">{d.rawNote}</pre></details>
        </article>;
      })}</div>
    </section>
  </Shell>;
}
