'use client';

import { useMemo } from 'react';
import { discountAmount } from '@/lib/earlypay/math';
import { DEMO_VAULT, useEarlyPay, statusOf, fmt } from '@/components/earlypay/shared';

/** Live figures for the demo vault, read from EarlyPayLedger events on Arc testnet. */
export default function LiveStats() {
  const { state } = useEarlyPay(DEMO_VAULT, undefined, 10000);
  const s = useMemo(() => {
    const r = { invoices: 0, paid: 0, paidUnits: 0n, discount: 0n, blocked: 0, suppliers: 0 };
    if (!state) return r;
    r.invoices = state.offers.length;
    r.suppliers = new Set(state.offers.map(o => o.offer.supplier.toLowerCase())).size;
    for (const o of state.offers) {
      const { decisions, settled } = statusOf(state, o);
      if (settled) { r.paid++; r.paidUnits += BigInt(settled.amount); r.discount += discountAmount(BigInt(o.offer.faceAmount), o.offer.discountBps); }
      if (decisions.some(d => d.decision === 'REJECT' && d.note?.source !== 'owner')) r.blocked++;
    }
    return r;
  }, [state]);
  return <div className="stats" aria-live="polite">
    <div className="stat"><b>{s.invoices}</b><span>invoices from {s.suppliers} suppliers</span></div>
    <div className="stat"><b>{s.paid}</b><span>paid early</span></div>
    <div className="stat"><b>{fmt(s.paidUnits)}</b><span>USDC paid early</span></div>
    <div className="stat"><b>{s.blocked}</b><span>attacks blocked</span></div>
  </div>;
}
