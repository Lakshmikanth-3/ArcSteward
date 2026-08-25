/**
 * lib/rooster/types.ts
 * Shared types for the Rooster Agents integration (Base Sepolia settlement rail).
 *
 * RoosterCapability mirrors Velo402's on-chain PolicyCap semantics — budget
 * ceiling, scope/destination allow-list, one-time use, expiration — but is a
 * self-contained off-chain record for this rail. Nothing here reads Sui state.
 */

export type Platform =
  | "instagram"
  | "tiktok"
  | "youtube"
  | "facebook"
  | "x"
  | "linkedin";

export type DeliverableKind = "post" | "reel" | "story" | "shoutout" | "video";
export type Audience = "targeted" | "board";
export type Currency = "USDC" | "USD";

export interface Deliverable {
  platform: Platform;
  kind: DeliverableKind;
  caption: string;
  mediaUrl?: string;
  linkUrl?: string;
}

export type SandboxChain = "BASE-SEPOLIA";
export type SandboxOutcome = "refund";

/** Developer-facing offer input. RoosterClient flattens this to Rooster's real wire schema. */
export interface OfferInput {
  creatorCode?: string; // required when audience === "targeted" (the default) and not sandbox
  audience?: Audience;
  boardEligibility?: string; // board offers only
  deliverable: Deliverable;
  priceCents: number;
  currency: Currency;
  testMode: boolean;
  agentName: string;
  agentOperator?: string;
  agentEndpoint?: string;
  agentWallet?: string;
  /**
   * Auto-accepted by a labelled, explicitly-non-human Rooster sandbox
   * creator — reaches real awaiting_funding/funded/released states against
   * a genuine per-offer testnet escrow wallet, without needing a real human
   * to accept. Mutually exclusive with testMode. Confirmed live 2026-08-24
   * (server v1.3.0). creatorCode/agentName are ignored by Rooster for
   * sandbox offers; agentWallet is required (refund destination).
   */
  sandbox?: boolean;
  sandboxChain?: SandboxChain;
  /** Omit for the default (post succeeds, escrow releases); "refund" forces the post to fail. */
  sandboxOutcome?: SandboxOutcome;
}

export interface Offer {
  offerId: string;
  raw: unknown;
}

export interface Creator {
  code: string;
  platforms: Platform[];
  raw: unknown;
}

export interface MarketBenchmark {
  raw: unknown;
}

/**
 * Normalized offer lifecycle — a superset of Rooster's documented real states
 * and the provisioning states this integration's spec called out. Any status
 * string we don't recognize maps to "unknown" (logged, never thrown) rather
 * than assuming a schema we haven't observed from a live response.
 */
export type OfferState =
  | "pending"
  | "accepted"
  | "rejected"
  | "countered"
  | "provisioning"
  | "awaiting_funding"
  | "funded"
  | "releasing"
  | "released"
  | "refunded"
  | "expired_unfunded"
  | "awaiting_payout_wallet"
  /** testMode-only synthetic terminal state — the whole lifecycle was simulated,
   *  nothing was ever posted or paid. Confirmed live against a real testMode
   *  offer (2026-08-24): decisionNote reads "SIMULATED acceptance — test mode.
   *  No human contacted, nothing posted, no money moved." */
  | "posted_simulated"
  | "unknown";

export const TERMINAL_OFFER_STATES: ReadonlySet<OfferState> = new Set([
  "rejected",
  "released",
  "refunded",
  "expired_unfunded",
  "posted_simulated",
]);

/**
 * Rooster's `lifecycle` field (server-side fix live 2026-08-25) — the single
 * authoritative source of truth for an offer's stage, replacing the old
 * two-field `status`/`escrowStatus` split where `status` froze at "posted"
 * forever after acceptance. `status`/`escrowStatus` still ship unchanged
 * underneath (see OfferState above) for callers that already depend on them.
 */
const OFFER_LIFECYCLE_VALUES = [
  "pending_human_decision",
  "countered",
  "rejected",
  "expired",
  "accepted",
  "provisioning_escrow",
  "awaiting_funding",
  "funded_delivery_in_progress",
  "post_failed_refund_pending",
  "delivered_awaiting_creator_wallet",
  "releasing",
  "completed",
  "refunded",
  "refund_failed",
  "expired_unfunded",
  "escrow_error",
  "test_completed_simulated",
] as const;

export type OfferLifecycle = (typeof OFFER_LIFECYCLE_VALUES)[number] | "unknown";

/** Every recognized lifecycle value — used to validate/normalize a raw API string. */
export const OFFER_LIFECYCLE_SET: ReadonlySet<string> = new Set(OFFER_LIFECYCLE_VALUES);

export const TERMINAL_LIFECYCLE_VALUES: ReadonlySet<OfferLifecycle> = new Set([
  "rejected",
  "expired",
  "completed",
  "refunded",
  "refund_failed",
  "expired_unfunded",
  "escrow_error",
  "test_completed_simulated",
]);

/**
 * Outcome classification, layered on top of TERMINAL_LIFECYCLE_VALUES.
 * Deliberately narrow: only the lifecycle values the integration spec
 * actually names get a bucket. `rejected`/`expired`/`expired_unfunded` are
 * terminal (see above) but benign-declined outcomes, not failures — no
 * money was ever at risk — so they're intentionally left out of
 * ATTENTION_LIFECYCLE_VALUES rather than lumped in with refund_failed/
 * escrow_error, which mean something is actually stuck and needs a human.
 */
export const SUCCESS_LIFECYCLE_VALUES: ReadonlySet<OfferLifecycle> = new Set([
  "completed",
  "test_completed_simulated",
]);

export const REFUND_LIFECYCLE_VALUES: ReadonlySet<OfferLifecycle> = new Set([
  "refunded",
]);

/** Terminal outcomes that need a human to look, distinct from a benign decline/expiry. */
export const ATTENTION_LIFECYCLE_VALUES: ReadonlySet<OfferLifecycle> = new Set([
  "refund_failed",
  "escrow_error",
]);

export type LifecycleOutcome = "success" | "refund_success" | "attention_required" | "pending";

/**
 * Classifies a lifecycle value for callers that just want to know "did this
 * work." Anything terminal but not in one of the three named Sets above
 * (e.g. rejected, expired, expired_unfunded) — and anything non-terminal —
 * falls out as "pending" by omission, matching OFFER_LIFECYCLE_SET's own
 * never-throw-just-don't-match convention. Never exhaustively switches over
 * OfferLifecycle, so a new value Rooster ships tomorrow doesn't need a code
 * change here to stay safe (it just stays "pending").
 */
export function classifyLifecycleOutcome(lifecycle: OfferLifecycle): LifecycleOutcome {
  if (SUCCESS_LIFECYCLE_VALUES.has(lifecycle)) return "success";
  if (REFUND_LIFECYCLE_VALUES.has(lifecycle)) return "refund_success";
  if (ATTENTION_LIFECYCLE_VALUES.has(lifecycle)) return "attention_required";
  return "pending";
}

export interface OfferStatus {
  offerId: string;
  state: OfferState;
  /** Rooster's authoritative lifecycle field. Switch on this, not `state`. */
  lifecycle: OfferLifecycle;
  /** True once the offer has reached a terminal lifecycle — stop polling. */
  terminal: boolean;
  /** Present once the human accepts and escrow funding info is available. */
  funding?: {
    depositAddress: string;
    /** Actual amount owed INCLUDING the marketplace fee — not priceCents. */
    amountCents: number;
    /** Canonical decimal-string form of amountCents (e.g. "5.75") — never float math, derived via integer cents. */
    amountUsdc: string;
    currency: Currency;
    deadline?: string; // ISO timestamp, ~72h from acceptance
  };
  counterPriceCents?: number;
  /** Present once Rooster has released escrow to the creator (real offers only). */
  releaseTxHash?: string;
  /** Present once Rooster has refunded the agent (real offers only). */
  refundTxHash?: string;
  /**
   * ISO timestamp — only meaningful when lifecycle is
   * "delivered_awaiting_creator_wallet": the creator delivered but hasn't
   * supplied a payout wallet yet, and funds auto-refund at this time if one
   * still hasn't been supplied. Passthrough only — never invented if
   * Rooster's response doesn't include it.
   */
  autoRefundAt?: string;
  raw: unknown;
}

export type FundingState =
  | "PENDING"
  | "SUBMITTED"
  | "CONFIRMED"
  | "FAILED"
  | "REFUNDED";

export interface RoosterCapability {
  agentId: string;
  destination: "rooster";
  currency: Currency;
  maxAmountCents: number;
  /** Present => this capability only authorizes funding this one offer. */
  offerId?: string;
  oneTime: boolean;
  issuedAt: string; // ISO
  expiresAt: string; // ISO
  revoked?: boolean;
}

export interface ReconciliationRecord {
  idempotencyKey: string;
  agentId: string;
  offerId: string;
  capabilitySnapshot: RoosterCapability;
  depositAddress?: string;
  amountCents?: number;
  network: string;
  /** Our own funding transaction hash — tracked independently of Rooster's release/refund tx below. */
  txHash?: string;
  /** Tracks OUR funding tx only. Rooster's offer outcome is tracked via `lifecycle` below instead. */
  state: FundingState;
  /** Rooster's own offer lifecycle, opportunistically merged in via reconcileFromStatus(). */
  lifecycle?: OfferLifecycle;
  /** Present once Rooster has released escrow to the creator. */
  releaseTx?: string;
  /** Present once Rooster has refunded the agent. */
  refundTx?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

export class RoosterApiError extends Error {
  readonly status?: number;
  readonly body?: unknown;
  constructor(message: string, status?: number, body?: unknown) {
    super(message);
    this.name = "RoosterApiError";
    this.status = status;
    this.body = body;
  }
}

export class RoosterValidationError extends Error {
  readonly issues: string[];
  constructor(message: string, issues: string[]) {
    super(message);
    this.name = "RoosterValidationError";
    this.issues = issues;
  }
}

export class CapabilityDeniedError extends Error {
  readonly reason: string;
  constructor(message: string, reason: string) {
    super(message);
    this.name = "CapabilityDeniedError";
    this.reason = reason;
  }
}

export class SettlementNotImplementedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettlementNotImplementedError";
  }
}
