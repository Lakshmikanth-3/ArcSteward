/**
 * lib/rooster/capability.ts
 * The Rooster funding authorization gate — Velo402's capability model
 * applied to this rail. Entirely self-contained (no Sui RPC): the sole
 * source of truth is the RoosterCapability record issued by the operator
 * via capability-store.ts.
 *
 * Implements the checklist from the integration spec:
 *   1. Agent authorized to spend at all       -> capability exists, not revoked
 *   2. Destination allow-listed                -> ALLOWED_DESTINATIONS
 *   3. Requested amount within spending limit   -> amountCents <= capability.maxAmountCents
 *   4. Currency allow-listed                    -> ALLOWED_CURRENCIES + capability match
 *   5. This specific offer authorized            -> capability.offerId match (if offer-scoped)
 *   6. Offer not already funded                  -> ledger lookup, one-time enforcement
 *   7. Request replay handled safely              -> idempotency key in ledger-store
 *                                                    (createPendingRecord is idempotent;
 *                                                    see api/rooster/offers/[offerId]/fund)
 *   8. Authorization not expired                  -> capability.expiresAt vs now
 */
import { CapabilityDeniedError, type RoosterCapability } from "./types";
import { getCapability } from "./capability-store";
import { getRecordByOfferId } from "./ledger-store";

const ALLOWED_DESTINATIONS = new Set(["rooster"]);
const ALLOWED_CURRENCIES = new Set(["USDC"]);

export interface AuthorizeRoosterSpendParams {
  agentId: string;
  offerId: string;
  destination: string;
  currency: string;
  /** The ACTUAL funding amount (offer price + marketplace fee), never raw priceCents. */
  amountCents: number;
  /** Injectable clock for deterministic tests. */
  now?: Date;
}

export interface AuthorizeRoosterSpendResult {
  capability: RoosterCapability;
}

export async function authorizeRoosterSpend(
  params: AuthorizeRoosterSpendParams,
): Promise<AuthorizeRoosterSpendResult> {
  const now = params.now ?? new Date();

  // 2. Destination allow-listed
  if (!ALLOWED_DESTINATIONS.has(params.destination)) {
    throw new CapabilityDeniedError(
      `Destination "${params.destination}" is not allow-listed.`,
      "DESTINATION_NOT_ALLOWED",
    );
  }

  // 4a. Currency allow-listed globally
  if (!ALLOWED_CURRENCIES.has(params.currency)) {
    throw new CapabilityDeniedError(
      `Currency "${params.currency}" is not allow-listed for Rooster funding.`,
      "CURRENCY_NOT_ALLOWED",
    );
  }

  if (params.amountCents <= 0) {
    throw new CapabilityDeniedError("Requested amount must be positive.", "INVALID_AMOUNT");
  }

  // 1. Agent authorized to spend at all
  const capability = await getCapability(params.agentId, params.offerId);
  if (!capability) {
    throw new CapabilityDeniedError(
      `No RoosterCapability found for agent "${params.agentId}".`,
      "NOT_AUTHORIZED",
    );
  }
  if (capability.revoked) {
    throw new CapabilityDeniedError("Capability has been revoked.", "REVOKED");
  }

  // 4b. Capability's own currency scope (defense in depth beyond the global allow-list)
  if (capability.currency !== params.currency) {
    throw new CapabilityDeniedError(
      `Capability is scoped to currency "${capability.currency}", not "${params.currency}".`,
      "CURRENCY_NOT_ALLOWED",
    );
  }

  // 5. Offer-specific match — reject a different offer than the capability was scoped to
  if (capability.offerId && capability.offerId !== params.offerId) {
    throw new CapabilityDeniedError(
      `Capability is scoped to offer "${capability.offerId}", not "${params.offerId}".`,
      "OFFER_MISMATCH",
    );
  }

  // 8. Expiration
  if (new Date(capability.expiresAt).getTime() < now.getTime()) {
    throw new CapabilityDeniedError(`Capability expired at ${capability.expiresAt}.`, "EXPIRED");
  }

  // 3. Spend ceiling
  if (params.amountCents > capability.maxAmountCents) {
    throw new CapabilityDeniedError(
      `Requested amount ${params.amountCents}c exceeds capability ceiling ${capability.maxAmountCents}c.`,
      "OVER_BUDGET",
    );
  }

  // 6. Already funded (one-time enforcement)
  if (capability.oneTime) {
    const existing = await getRecordByOfferId(params.offerId);
    if (existing && (existing.state === "SUBMITTED" || existing.state === "CONFIRMED")) {
      throw new CapabilityDeniedError(
        `Offer "${params.offerId}" has already been funded (state ${existing.state}).`,
        "ALREADY_FUNDED",
      );
    }
  }

  return { capability };
}
