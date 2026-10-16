// Deterministic EarlyPay arithmetic. Money is USDC base units (6 decimals) as bigint;
// rates are basis points (1 bps = 0.01%). The LLM never computes any of this.
export const DAY = 86_400;
export const BPS = 10_000n;

/** Whole days between now and the due date, rounded up; 0 if due or overdue. */
export function daysEarly(dueDate: number, now: number) {
  return Math.max(0, Math.ceil((dueDate - now) / DAY));
}

export function discountAmount(face: bigint, discountBps: number) {
  if (face < 0n || discountBps < 0) throw new Error('Negative input');
  return (face * BigInt(discountBps)) / BPS;
}

/** What the supplier receives if paid early. */
export function earlyPayout(face: bigint, discountBps: number) {
  return face - discountAmount(face, discountBps);
}

/** Simple annualised return of the discount on the face amount, in bps: discount% × 365 / days. */
export function discountAprBps(discountBps: number, days: number) {
  if (days <= 0) return 0;
  return Math.round((discountBps * 365) / days);
}

/** Smallest discount (bps) that reaches the hurdle APR for paying `days` early, clamped to [min, max]. */
export function proposeDiscountBps(days: number, hurdleAprBps: number, minBps: number, maxBps: number) {
  if (days <= 0) return minBps;
  const needed = Math.ceil((hurdleAprBps * days) / 365);
  return Math.min(maxBps, Math.max(minBps, needed));
}

/** USDC the held cash would earn over `days` at `yieldBps` APR (what paying early gives up). */
export function holdEarnings(amount: bigint, yieldBps: number, days: number) {
  return (amount * BigInt(yieldBps) * BigInt(days)) / (BPS * 365n);
}

export type Obligation = { invoiceHash: string; face: bigint; dueDate: number };

/** Total face value due within `windowDays`, excluding one invoice (the one being decided). */
export function obligationsWithin(obligations: Obligation[], now: number, windowDays: number, exclude?: string) {
  const limit = now + windowDays * DAY;
  return obligations.filter(o => o.invoiceHash !== exclude && o.dueDate <= limit).reduce((sum, o) => sum + o.face, 0n);
}

/** Cash left after paying `payout` now and setting aside everything due in the window. Can be negative. */
export function runwayAfter(balance: bigint, payout: bigint, obligations30d: bigint) {
  return balance - payout - obligations30d;
}

export const usdc = (units: bigint) => {
  const neg = units < 0n, v = neg ? -units : units;
  const whole = v / 1_000_000n, frac = (v % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`;
};
export const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
