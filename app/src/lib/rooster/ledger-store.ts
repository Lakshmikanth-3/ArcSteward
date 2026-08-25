/**
 * lib/rooster/ledger-store.ts
 * Idempotency + reconciliation ledger for Rooster funding operations.
 *
 * Maps: RoosterCapability -> offerId -> deposit address -> txHash -> settlement state,
 * per the reconciliation requirement — "which Velo402 authorization funded
 * which Rooster offer" must always be answerable from this store.
 */
import { createHash } from "node:crypto";
import { createStore, type Store } from "./store";
import { REFUND_LIFECYCLE_VALUES, SUCCESS_LIFECYCLE_VALUES } from "./types";
import type { FundingState, OfferStatus, ReconciliationRecord, RoosterCapability } from "./types";

// Lazily constructed so tests can point ROOSTER_LEDGER_STORE_PATH at a temp
// file before the first store operation, without needing dynamic import.
// createStore() picks Supabase (serverless-safe) when configured, else this
// same local FileStore fallback.
let _store: Store<ReconciliationRecord> | null = null;
function store(): Store<ReconciliationRecord> {
  if (!_store) {
    _store = createStore<ReconciliationRecord>({
      name: "rooster-ledger",
      filePathEnvVar: "ROOSTER_LEDGER_STORE_PATH",
      defaultFilePath: ".data/rooster-ledger.json",
    });
  }
  return _store;
}

/** Deterministic per (agent, offer, purpose) — the same funding attempt always maps here. */
export function computeIdempotencyKey(
  agentId: string,
  offerId: string,
  purpose: string,
): string {
  return createHash("sha256").update(`${agentId}:${offerId}:${purpose}`).digest("hex");
}

export async function getRecord(
  idempotencyKey: string,
): Promise<ReconciliationRecord | undefined> {
  return store().get(idempotencyKey);
}

export async function getRecordByOfferId(
  offerId: string,
): Promise<ReconciliationRecord | undefined> {
  const all = await store().getAll();
  return Object.values(all).find((r) => r.offerId === offerId);
}

/** All reconciliation records, most recently updated first. */
export async function listRecords(): Promise<ReconciliationRecord[]> {
  const all = await store().getAll();
  return Object.values(all).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export interface CreatePendingRecordParams {
  idempotencyKey: string;
  agentId: string;
  offerId: string;
  capability: RoosterCapability;
  network: string;
  amountCents: number;
  depositAddress: string;
}

/**
 * Creates a PENDING record, or returns the existing one unchanged if this
 * idempotency key was already used — a retry of the same funding attempt is
 * always safe and never creates a second record.
 */
export async function createPendingRecord(
  params: CreatePendingRecordParams,
): Promise<ReconciliationRecord> {
  return store().update(params.idempotencyKey, (existing) => {
    if (existing) return existing;
    const now = new Date().toISOString();
    return {
      idempotencyKey: params.idempotencyKey,
      agentId: params.agentId,
      offerId: params.offerId,
      capabilitySnapshot: params.capability,
      depositAddress: params.depositAddress,
      amountCents: params.amountCents,
      network: params.network,
      state: "PENDING",
      createdAt: now,
      updatedAt: now,
    };
  });
}

type ReconciledPatch = Pick<ReconciliationRecord, "lifecycle" | "releaseTx" | "refundTx" | "state">;

function computeReconciledPatch(
  current: ReconciliationRecord,
  status: Pick<OfferStatus, "lifecycle" | "releaseTxHash" | "refundTxHash">,
): ReconciledPatch {
  const releaseTx = status.releaseTxHash ?? current.releaseTx;
  const refundTx = status.refundTxHash ?? current.refundTx;
  const lifecycle = status.lifecycle !== "unknown" ? status.lifecycle : current.lifecycle;

  let state: FundingState = current.state;
  if (SUCCESS_LIFECYCLE_VALUES.has(status.lifecycle) && releaseTx && current.state === "SUBMITTED") {
    state = "CONFIRMED";
  } else if (REFUND_LIFECYCLE_VALUES.has(status.lifecycle) && refundTx) {
    state = "REFUNDED";
  }

  return { lifecycle, releaseTx, refundTx, state };
}

function isUnchanged(current: ReconciliationRecord, patch: ReconciledPatch): boolean {
  return (
    patch.lifecycle === current.lifecycle &&
    patch.releaseTx === current.releaseTx &&
    patch.refundTx === current.refundTx &&
    patch.state === current.state
  );
}

/**
 * Opportunistically merges Rooster's own offer-outcome fields (lifecycle,
 * releaseTx, refundTx) into the matching reconciliation record, and
 * transitions the ledger's FundingState (SUBMITTED -> CONFIRMED on a
 * successful release, or -> REFUNDED on a refund). `state` here tracks OUR
 * funding tx only — this is a distinct concept from Rooster's own
 * `lifecycle`, which is merged in alongside it, not folded into the same
 * enum.
 *
 * No-ops entirely if no record exists for this offerId — an offer never
 * funded through this app must never gain a ledger entry merely because its
 * live status was checked. Safe to call on every poll/status-refresh: skips
 * the write when nothing would actually change, and never downgrades a
 * previously observed value (a missing field on this call falls back to
 * what was already recorded).
 */
export async function reconcileFromStatus(
  offerId: string,
  status: Pick<OfferStatus, "lifecycle" | "releaseTxHash" | "refundTxHash">,
): Promise<ReconciliationRecord | undefined> {
  const existing = await getRecordByOfferId(offerId);
  if (!existing) return undefined;

  if (isUnchanged(existing, computeReconciledPatch(existing, status))) {
    return existing;
  }

  return store().update(existing.idempotencyKey, (current) => {
    const base = current ?? existing;
    const patch = computeReconciledPatch(base, status);
    if (isUnchanged(base, patch)) return base;
    return { ...base, ...patch, updatedAt: new Date().toISOString() };
  });
}

export async function updateRecordState(
  idempotencyKey: string,
  state: FundingState,
  patch: Partial<Pick<ReconciliationRecord, "txHash" | "error">> = {},
): Promise<ReconciliationRecord> {
  return store().update(idempotencyKey, (existing) => {
    if (!existing) {
      throw new Error(`No reconciliation record for idempotency key ${idempotencyKey}`);
    }
    return { ...existing, state, ...patch, updatedAt: new Date().toISOString() };
  });
}
