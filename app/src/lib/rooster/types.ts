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

/** Developer-facing offer input. RoosterClient flattens this to Rooster's real wire schema. */
export interface OfferInput {
  creatorCode?: string; // required when audience === "targeted" (the default)
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

export interface OfferStatus {
  offerId: string;
  state: OfferState;
  /** Present once the human accepts and escrow funding info is available. */
  funding?: {
    depositAddress: string;
    /** Actual amount owed INCLUDING the marketplace fee — not priceCents. */
    amountCents: number;
    currency: Currency;
    deadline?: string; // ISO timestamp, ~72h from acceptance
  };
  counterPriceCents?: number;
  /** Present once Rooster has released escrow to the creator (real offers only). */
  releaseTxHash?: string;
  /** Present once Rooster has refunded the agent (real offers only). */
  refundTxHash?: string;
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
  txHash?: string;
  state: FundingState;
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
