// Shared EarlyPay types (agent, API routes and pages).
export type Hex = `0x${string}`;

export const DECISIONS = ['PAY_EARLY', 'HOLD', 'ESCALATE', 'REJECT', 'HUMAN_APPROVED'] as const;
export type Decision = (typeof DECISIONS)[number];

/** Supplier-signed EIP-712 offer, as stored on EarlyPayLedger. */
export type Offer = {
  vault: Hex; supplier: Hex; invoiceHash: Hex; faceAmount: bigint; discountBps: number;
  payout: Hex; dueDate: bigint; expiry: bigint;
};

/** Untrusted invoice detail submitted with the offer. */
export type OfferMeta = { number?: string; description?: string; notes?: string; supplierName?: string; currency?: string };

/** Owner-configured early-pay policy (off-chain; the vault's on-chain limits apply regardless). */
export type EarlyPayPolicy = {
  hurdleMarginBps: number;   // extra APR the discount must beat on top of the hold yield
  minDiscountBps: number;
  maxDiscountBps: number;
  liquidityBuffer: bigint;   // USDC that must remain after the payment and 30-day obligations
  holdYieldBps: number;      // what idle cash earns (USYC if available, else a simulated reserve rate)
  holdYieldSource: 'USYC' | 'simulated';
  anomalyMultiple: number;   // escalate if amount > this × supplier's median paid invoice
};

export const DEFAULT_POLICY: EarlyPayPolicy = {
  hurdleMarginBps: 200, minDiscountBps: 50, maxDiscountBps: 500,
  liquidityBuffer: 2_000_000n, holdYieldBps: 450, holdYieldSource: 'simulated', anomalyMultiple: 3,
};

/** Live on-chain facts about the offer, read by the agent before deciding. */
export type ChainFacts = {
  now: number;
  offerCheck: 'ok' | 'BadSignature' | 'OfferExpired' | 'NotRegistered' | 'PayoutMismatch' | 'PayoutCoolingDown' | 'AlreadySettled' | 'InvalidInput' | string;
  registeredPayout?: Hex;
  vaultAllowsPayout: boolean;      // supplier payout on the vault allowlist (owner's "Approve supplier")
  invoiceUsedInVault: boolean;     // vault.usedPaymentIds(agent, invoiceHash)
  vaultBalance: bigint;
  maxPayment: bigint; remainingBudget: bigint; dailyRemaining: bigint;
  agentActive: boolean;
};

export type RiskFlag = { code: string; severity: 'reject' | 'escalate' | 'info'; detail: string };
