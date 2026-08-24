/**
 * lib/rooster/ledger-store.ts
 * Idempotency + reconciliation ledger for Rooster funding operations.
 *
 * Maps: RoosterCapability -> offerId -> deposit address -> txHash -> settlement state,
 * per the reconciliation requirement — "which Velo402 authorization funded
 * which Rooster offer" must always be answerable from this store.
 */
import { createHash } from "node:crypto";
import { FileStore } from "./file-store";
import type { FundingState, ReconciliationRecord, RoosterCapability } from "./types";

// Lazily constructed so tests can point ROOSTER_LEDGER_STORE_PATH at a temp
// file before the first store operation, without needing dynamic import.
let _store: FileStore<ReconciliationRecord> | null = null;
function store(): FileStore<ReconciliationRecord> {
  if (!_store) {
    _store = new FileStore<ReconciliationRecord>(
      process.env.ROOSTER_LEDGER_STORE_PATH ?? ".data/rooster-ledger.json",
    );
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
