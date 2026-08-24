/**
 * lib/rooster/capability-store.ts
 * Persists operator-issued RoosterCapability records — the off-chain
 * stand-in for velo_wallet::mint_policy on this rail. The operator issues a
 * capability (via a script or the operator-only /api/rooster/capabilities
 * route); the agent consumes it. Not agent self-service.
 */
import { FileStore } from "./file-store";
import { CapabilityDeniedError, type RoosterCapability } from "./types";

// Lazily constructed so tests can point ROOSTER_CAPABILITY_STORE_PATH at a
// temp file before the first store operation, without needing dynamic import.
let _store: FileStore<RoosterCapability> | null = null;
function store(): FileStore<RoosterCapability> {
  if (!_store) {
    _store = new FileStore<RoosterCapability>(
      process.env.ROOSTER_CAPABILITY_STORE_PATH ?? ".data/rooster-capabilities.json",
    );
  }
  return _store;
}

function capabilityKey(agentId: string, offerId?: string): string {
  return offerId ? `${agentId}:${offerId}` : `${agentId}:*`;
}

export interface IssueCapabilityParams {
  agentId: string;
  currency: RoosterCapability["currency"];
  maxAmountCents: number;
  /** Omit for a multi-offer capability with a shared ceiling; set for a one-offer capability. */
  offerId?: string;
  oneTime: boolean;
  ttlMinutes: number;
}

export async function issueCapability(
  params: IssueCapabilityParams,
): Promise<RoosterCapability> {
  if (params.maxAmountCents <= 0) {
    throw new CapabilityDeniedError("maxAmountCents must be positive.", "INVALID_AMOUNT");
  }
  const now = new Date();
  const capability: RoosterCapability = {
    agentId: params.agentId,
    destination: "rooster",
    currency: params.currency,
    maxAmountCents: params.maxAmountCents,
    offerId: params.offerId,
    oneTime: params.oneTime,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + params.ttlMinutes * 60_000).toISOString(),
  };
  await store().set(capabilityKey(params.agentId, params.offerId), capability);
  return capability;
}

/**
 * Looks up the capability relevant to authorizing spend for this agent/offer.
 * Prefers an exact offer-specific match, then a wildcard (non-offer-specific)
 * capability. If neither exists but the agent holds a capability scoped to a
 * *different* offer, that is returned too — not because it authorizes
 * anything, but so authorizeRoosterSpend() can report a precise
 * OFFER_MISMATCH instead of a generic "no capability at all" NOT_AUTHORIZED.
 */
export async function getCapability(
  agentId: string,
  offerId: string,
): Promise<RoosterCapability | undefined> {
  const specific = await store().get(capabilityKey(agentId, offerId));
  if (specific) return specific;

  const wildcard = await store().get(capabilityKey(agentId));
  if (wildcard) return wildcard;

  const all = await store().getAll();
  const prefix = `${agentId}:`;
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(prefix)) return value;
  }
  return undefined;
}

export async function revokeCapability(agentId: string, offerId?: string): Promise<void> {
  const key = capabilityKey(agentId, offerId);
  const existing = await store().get(key);
  if (!existing) {
    throw new CapabilityDeniedError("No such capability to revoke.", "NOT_FOUND");
  }
  await store().set(key, { ...existing, revoked: true });
}
