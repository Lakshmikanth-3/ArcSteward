// Named view of ArcVault.capabilities(agent); keeps tuple indices in one place.
export type Capability = { maxTotal: bigint; maxPayment: bigint; maxPerDay: bigint; gasAllowance: bigint; spent: bigint; gasSpent: bigint; daySpent: bigint; day: bigint; expiresAt: bigint; version: bigint; active: boolean; useRegistry: boolean };
export function toCapability(c: readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint, boolean, boolean]): Capability {
  return { maxTotal: c[0], maxPayment: c[1], maxPerDay: c[2], gasAllowance: c[3], spent: c[4], gasSpent: c[5], daySpent: c[6], day: c[7], expiresAt: c[8], version: c[9], active: c[10], useRegistry: c[11] };
}
// Policy argument for ArcVault.authorize.
export type Policy = { maxTotal: bigint; maxPayment: bigint; maxPerDay: bigint; gasAllowance: bigint; expiresAt: bigint; useRegistry: boolean };
export const remainingBudget = (c: Capability) => c.maxTotal - c.spent;
export const dailyRemaining = (c: Capability, nowSec: bigint) => { const used = c.day === nowSec / 86400n ? c.daySpent : 0n; return c.maxPerDay > used ? c.maxPerDay - used : 0n; };
