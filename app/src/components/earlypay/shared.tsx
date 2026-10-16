'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

export const EXPLORER = 'https://explorer.testnet.arc.io';
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;
export const addrUrl = (a: string) => `${EXPLORER}/address/${a}`;
export const short = (a?: string) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '');
export const DEMO_VAULT = process.env.NEXT_PUBLIC_EARLYPAY_VAULT ?? '';
export const DEMO_AGENT = process.env.NEXT_PUBLIC_EARLYPAY_AGENT ?? '';
export const fmt = (units: string | bigint | undefined) => {
  if (units === undefined) return '—';
  const v = BigInt(units), whole = v / 1_000_000n, frac = (v % 1_000_000n).toString().padStart(6, '0').slice(0, 2);
  return `${whole}.${frac}`;
};

const links = [
  ['/earlypay', 'EarlyPay'], ['/earlypay/supplier', 'Supplier'], ['/earlypay/buyer', 'Buyer'], ['/earlypay/audit', 'Audit'],
] as const;

export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  return <div className="codex ep">
    <nav className="nav">
      <Link className="brand" href="/">ArcSteward</Link>
      <div className="links">{links.map(([href, label]) => <Link key={href} href={href} aria-current={path === href ? 'page' : undefined}>{label}</Link>)}<Link href="/arc">Vault console</Link></div>
      <span className="net-badge">Arc testnet</span>
    </nav>
    <main>{children}</main>
    <footer className="foot"><span>© 2026 ArcSteward EarlyPay · built for the Tameion Agents Hackathon</span><div><Link href="/security">Security</Link><Link href="/earlypay/audit">Audit</Link><a href={EXPLORER} target="_blank" rel="noreferrer">Arc testnet explorer ↗</a></div></footer>
  </div>;
}

// ── State from /api/earlypay/state (bigints arrive as strings) ─────────────
export type SOffer = { offer: { vault: string; supplier: string; invoiceHash: string; faceAmount: string; discountBps: number; payout: string; dueDate: string; expiry: string }; signature: string; offerHash: string; meta: { number?: string; description?: string; notes?: string; supplierName?: string; currency?: string }; tx: string };
export type SDecision = { vault: string; invoiceHash: string; offerHash: string; decision: string; inputsHash: string; prevHash: string; decisionHash: string; recorder: string; tx: string; block: string; rawNote: string; note?: { reason: string; source: string; overridden?: string; inputs: Record<string, unknown>; payment?: { tx: string; amount: string; by: string } } };
export type SSettlement = { invoiceHash: string; payout: string; amount: string; paymentTx: string; recorder: string; tx: string };
export type EpState = { network: string; ledger: string; vault: string; owner?: string; balance?: string; now: number; agent?: string; offers: SOffer[]; decisions: SDecision[]; settlements: SSettlement[]; suppliers: { supplier: string; payout: string; block: string; tx: string }[]; chain: { valid: boolean; brokenAt: number; why: string } };

export function useEarlyPay(vault: string, supplier?: string, everyMs = 6000) {
  const [state, setState] = useState<EpState>();
  const [error, setError] = useState<string>();
  const load = useCallback(async () => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(vault)) return;
    try {
      const res = await fetch(`/api/earlypay/state?vault=${vault}${supplier ? `&supplier=${supplier}` : ''}`, { cache: 'no-store' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? 'Could not read Arc');
      setState(body); setError(undefined);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [vault, supplier]);
  useEffect(() => { const first = setTimeout(load, 0); const t = everyMs ? setInterval(load, everyMs) : undefined; return () => { clearTimeout(first); if (t) clearInterval(t); }; }, [load, everyMs]);
  return { state, error, reload: load };
}

/** Latest decision and settlement per offer. */
export function statusOf(state: EpState | undefined, o: SOffer) {
  const decisions = state?.decisions.filter(d => d.invoiceHash.toLowerCase() === o.offer.invoiceHash.toLowerCase()) ?? [];
  const latest = decisions[decisions.length - 1];
  const settled = state?.settlements.find(s => s.invoiceHash.toLowerCase() === o.offer.invoiceHash.toLowerCase());
  return { latest, decisions, settled };
}

export function DecisionTag({ d, settled }: { d?: string; settled?: boolean }) {
  if (settled) return <span className="tag paid">PAID</span>;
  return <span className={`tag ${d ?? 'pending'}`}>{d ? d.replace('_', ' ') : 'WAITING FOR AGENT'}</span>;
}
