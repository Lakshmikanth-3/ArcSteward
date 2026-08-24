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
  updateRecordState,
} from "../ledger-store";

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
