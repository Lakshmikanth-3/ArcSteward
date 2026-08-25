import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import type { RoosterCapability } from "../types";

process.env.ROOSTER_LEDGER_STORE_PATH = path.join(
  os.tmpdir(),
  `rooster-ledger-idempotency-test-${process.pid}-${Date.now()}.json`,
);

import {
  computeIdempotencyKey,
  createPendingRecord,
  getRecord,
  getRecordByOfferId,
  reconcileFromStatus,
  updateRecordState,
} from "../ledger-store";
import type { OfferStatus } from "../types";

function fakeStatus(
  overrides: Partial<Pick<OfferStatus, "lifecycle" | "releaseTxHash" | "refundTxHash">>,
): Pick<OfferStatus, "lifecycle" | "releaseTxHash" | "refundTxHash"> {
  return { lifecycle: "unknown", releaseTxHash: undefined, refundTxHash: undefined, ...overrides };
}

function fakeCapability(agentId: string, offerId: string): RoosterCapability {
  const now = new Date();
  return {
    agentId,
    destination: "rooster",
    currency: "USDC",
    maxAmountCents: 2500,
    offerId,
    oneTime: true,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
  };
}

test("computeIdempotencyKey is deterministic for the same inputs", () => {
  const a = computeIdempotencyKey("agent-1", "offer-1", "fund");
  const b = computeIdempotencyKey("agent-1", "offer-1", "fund");
  const c = computeIdempotencyKey("agent-1", "offer-2", "fund");
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("createPendingRecord is idempotent — a duplicate call does not overwrite", async () => {
  const agentId = "agent-dup";
  const offerId = "offer-dup";
  const key = computeIdempotencyKey(agentId, offerId, "fund");
  const capability = fakeCapability(agentId, offerId);

  const first = await createPendingRecord({
    idempotencyKey: key,
    agentId,
    offerId,
    capability,
    network: "base-sepolia",
    amountCents: 2500,
    depositAddress: "0xdeposit1",
  });

  // A "retry" with a different deposit address should NOT overwrite the
  // original PENDING record — same idempotency key always wins.
  const second = await createPendingRecord({
    idempotencyKey: key,
    agentId,
    offerId,
    capability,
    network: "base-sepolia",
    amountCents: 9999,
    depositAddress: "0xdeposit2",
  });

  assert.equal(first.createdAt, second.createdAt);
  assert.equal(second.depositAddress, "0xdeposit1");
  assert.equal(second.amountCents, 2500);
});

test("retry after process restart sees the same record via a fresh FileStore read", async () => {
  const agentId = "agent-restart";
  const offerId = "offer-restart";
  const key = computeIdempotencyKey(agentId, offerId, "fund");
  const capability = fakeCapability(agentId, offerId);

  await createPendingRecord({
    idempotencyKey: key,
    agentId,
    offerId,
    capability,
    network: "base-sepolia",
    amountCents: 1000,
    depositAddress: "0xdeposit3",
  });
  await updateRecordState(key, "SUBMITTED", { txHash: "0xtxhash" });

  // Simulate a process restart: read the persisted JSON file directly,
  // bypassing the in-memory cache entirely.
  const filePath = process.env.ROOSTER_LEDGER_STORE_PATH!;
  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  const persisted = raw[key];

  assert.equal(persisted.state, "SUBMITTED");
  assert.equal(persisted.txHash, "0xtxhash");

  // And the in-process read agrees.
  const record = await getRecord(key);
  assert.equal(record?.state, "SUBMITTED");
});

test("concurrent writes to different keys do not clobber each other", async () => {
  const writes = Array.from({ length: 10 }, (_, i) => {
    const agentId = `agent-concurrent-${i}`;
    const offerId = `offer-concurrent-${i}`;
    const key = computeIdempotencyKey(agentId, offerId, "fund");
    return createPendingRecord({
      idempotencyKey: key,
      agentId,
      offerId,
      capability: fakeCapability(agentId, offerId),
      network: "base-sepolia",
      amountCents: 500,
      depositAddress: `0xdeposit-${i}`,
    }).then(() => key);
  });

  const keys = await Promise.all(writes);
  for (const key of keys) {
    const record = await getRecord(key);
    assert.ok(record, `expected a record for key ${key}`);
  }
});

test("reconcileFromStatus no-ops for an offer never funded through this app (reconciliation mismatch)", async () => {
  const offerId = "offer-never-funded";
  const result = await reconcileFromStatus(offerId, fakeStatus({ lifecycle: "completed", releaseTxHash: "0xr" }));
  assert.equal(result, undefined);
  // Must not have silently created a ledger entry from a status check alone.
  assert.equal(await getRecordByOfferId(offerId), undefined);
});

test("reconcileFromStatus transitions SUBMITTED -> CONFIRMED on a success lifecycle + releaseTx", async () => {
  const agentId = "agent-reconcile-success";
  const offerId = "offer-reconcile-success";
  const key = computeIdempotencyKey(agentId, offerId, "fund");
  await createPendingRecord({
    idempotencyKey: key,
    agentId,
    offerId,
    capability: fakeCapability(agentId, offerId),
    network: "base-sepolia",
    amountCents: 2500,
    depositAddress: "0xdeposit",
  });
  await updateRecordState(key, "SUBMITTED", { txHash: "0xfundtx" });

  const updated = await reconcileFromStatus(
    offerId,
    fakeStatus({ lifecycle: "completed", releaseTxHash: "0xrelease" }),
  );

  assert.equal(updated?.state, "CONFIRMED");
  assert.equal(updated?.lifecycle, "completed");
  assert.equal(updated?.releaseTx, "0xrelease");
  assert.equal(updated?.txHash, "0xfundtx"); // our own funding tx hash is untouched
});

test("reconcileFromStatus transitions to REFUNDED on a refund lifecycle + refundTx", async () => {
  const agentId = "agent-reconcile-refund";
  const offerId = "offer-reconcile-refund";
  const key = computeIdempotencyKey(agentId, offerId, "fund");
  await createPendingRecord({
    idempotencyKey: key,
    agentId,
    offerId,
    capability: fakeCapability(agentId, offerId),
    network: "base-sepolia",
    amountCents: 2500,
    depositAddress: "0xdeposit",
  });
  await updateRecordState(key, "SUBMITTED", { txHash: "0xfundtx" });

  const updated = await reconcileFromStatus(
    offerId,
    fakeStatus({ lifecycle: "refunded", refundTxHash: "0xrefund" }),
  );

  assert.equal(updated?.state, "REFUNDED");
  assert.equal(updated?.lifecycle, "refunded");
  assert.equal(updated?.refundTx, "0xrefund");
});

test("reconcileFromStatus never downgrades a previously observed value (monotonic merge)", async () => {
  const agentId = "agent-reconcile-monotonic";
  const offerId = "offer-reconcile-monotonic";
  const key = computeIdempotencyKey(agentId, offerId, "fund");
  await createPendingRecord({
    idempotencyKey: key,
    agentId,
    offerId,
    capability: fakeCapability(agentId, offerId),
    network: "base-sepolia",
    amountCents: 2500,
    depositAddress: "0xdeposit",
  });
  await updateRecordState(key, "SUBMITTED", { txHash: "0xfundtx" });

  await reconcileFromStatus(offerId, fakeStatus({ lifecycle: "completed", releaseTxHash: "0xrelease" }));

  // A later poll that (implausibly, but defensively) comes back "unknown"
  // must not erase the previously recorded lifecycle/releaseTx/CONFIRMED state.
  const second = await reconcileFromStatus(offerId, fakeStatus({ lifecycle: "unknown" }));

  assert.equal(second?.state, "CONFIRMED");
  assert.equal(second?.lifecycle, "completed");
  assert.equal(second?.releaseTx, "0xrelease");
});

test("reconcileFromStatus skips the write entirely when nothing would change (idempotent)", async () => {
  const agentId = "agent-reconcile-noop";
  const offerId = "offer-reconcile-noop";
  const key = computeIdempotencyKey(agentId, offerId, "fund");
  await createPendingRecord({
    idempotencyKey: key,
    agentId,
    offerId,
    capability: fakeCapability(agentId, offerId),
    network: "base-sepolia",
    amountCents: 2500,
    depositAddress: "0xdeposit",
  });
  await updateRecordState(key, "SUBMITTED", { txHash: "0xfundtx" });

  const first = await reconcileFromStatus(
    offerId,
    fakeStatus({ lifecycle: "completed", releaseTxHash: "0xrelease" }),
  );
  // Same status again — nothing should change, and updatedAt must not advance.
  const second = await reconcileFromStatus(
    offerId,
    fakeStatus({ lifecycle: "completed", releaseTxHash: "0xrelease" }),
  );

  assert.equal(first?.updatedAt, second?.updatedAt);
});
