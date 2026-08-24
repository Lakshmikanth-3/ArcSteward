import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { authorizeRoosterSpend } from "../capability";
import { issueCapability, revokeCapability } from "../capability-store";
import { createPendingRecord, computeIdempotencyKey, updateRecordState } from "../ledger-store";
import { CapabilityDeniedError } from "../types";

// Point both file-backed stores at unique temp files for this test run.
// capability-store.ts / ledger-store.ts construct their FileStore lazily on
// first use, so setting these before any store call (which happens inside
// the test bodies below, not at import time) is sufficient.
process.env.ROOSTER_CAPABILITY_STORE_PATH = path.join(
  os.tmpdir(),
  `rooster-capabilities-test-${process.pid}-${Date.now()}.json`,
);
process.env.ROOSTER_LEDGER_STORE_PATH = path.join(
  os.tmpdir(),
  `rooster-ledger-test-${process.pid}-${Date.now()}.json`,
);

let counter = 0;
function uniqueAgent(): string {
  counter += 1;
  return `agent-${process.pid}-${counter}`;
}

test("allows spend at exactly the capability ceiling ($25 against $25 cap)", async () => {
  const agentId = uniqueAgent();
  const offerId = "offer_1";
  await issueCapability({ agentId, currency: "USDC", maxAmountCents: 2500, offerId, oneTime: true, ttlMinutes: 60 });

  const { capability } = await authorizeRoosterSpend({
    agentId,
    offerId,
    destination: "rooster",
    currency: "USDC",
    amountCents: 2500,
  });
  assert.equal(capability.agentId, agentId);
});

test("allows spend under the ceiling ($20 against $25 cap)", async () => {
  const agentId = uniqueAgent();
  const offerId = "offer_2";
  await issueCapability({ agentId, currency: "USDC", maxAmountCents: 2500, offerId, oneTime: true, ttlMinutes: 60 });

  await assert.doesNotReject(() =>
    authorizeRoosterSpend({ agentId, offerId, destination: "rooster", currency: "USDC", amountCents: 2000 }),
  );
});

test("rejects spend over the ceiling ($30 against $25 cap)", async () => {
  const agentId = uniqueAgent();
  const offerId = "offer_3";
  await issueCapability({ agentId, currency: "USDC", maxAmountCents: 2500, offerId, oneTime: true, ttlMinutes: 60 });

  await assert.rejects(
    () => authorizeRoosterSpend({ agentId, offerId, destination: "rooster", currency: "USDC", amountCents: 3000 }),
    (err: unknown) => err instanceof CapabilityDeniedError && err.reason === "OVER_BUDGET",
  );
});

test("rejects a different offer than the capability is scoped to", async () => {
  const agentId = uniqueAgent();
  await issueCapability({
    agentId,
    currency: "USDC",
    maxAmountCents: 2500,
    offerId: "offer_scoped",
    oneTime: true,
    ttlMinutes: 60,
  });

  await assert.rejects(
    () =>
      authorizeRoosterSpend({
        agentId,
        offerId: "offer_other",
        destination: "rooster",
        currency: "USDC",
        amountCents: 1000,
      }),
    (err: unknown) => err instanceof CapabilityDeniedError && err.reason === "OFFER_MISMATCH",
  );
});

test("rejects an agent with no issued capability", async () => {
  const agentId = uniqueAgent();
  await assert.rejects(
    () =>
      authorizeRoosterSpend({
        agentId,
        offerId: "offer_none",
        destination: "rooster",
        currency: "USDC",
        amountCents: 1000,
      }),
    (err: unknown) => err instanceof CapabilityDeniedError && err.reason === "NOT_AUTHORIZED",
  );
});

test("rejects a revoked capability", async () => {
  const agentId = uniqueAgent();
  const offerId = "offer_revoked";
  await issueCapability({ agentId, currency: "USDC", maxAmountCents: 2500, offerId, oneTime: true, ttlMinutes: 60 });
  await revokeCapability(agentId, offerId);

  await assert.rejects(
    () => authorizeRoosterSpend({ agentId, offerId, destination: "rooster", currency: "USDC", amountCents: 1000 }),
    (err: unknown) => err instanceof CapabilityDeniedError && err.reason === "REVOKED",
  );
});

test("rejects an expired capability", async () => {
  const agentId = uniqueAgent();
  const offerId = "offer_expired";
  await issueCapability({
    agentId,
    currency: "USDC",
    maxAmountCents: 2500,
    offerId,
    oneTime: true,
    ttlMinutes: -1, // already expired
  });

  await assert.rejects(
    () => authorizeRoosterSpend({ agentId, offerId, destination: "rooster", currency: "USDC", amountCents: 1000 }),
    (err: unknown) => err instanceof CapabilityDeniedError && err.reason === "EXPIRED",
  );
});

test("rejects an unlisted destination", async () => {
  const agentId = uniqueAgent();
  await assert.rejects(
    () =>
      authorizeRoosterSpend({
        agentId,
        offerId: "offer_x",
        destination: "some-other-marketplace",
        currency: "USDC",
        amountCents: 1000,
      }),
    (err: unknown) => err instanceof CapabilityDeniedError && err.reason === "DESTINATION_NOT_ALLOWED",
  );
});

test("rejects an unlisted currency", async () => {
  const agentId = uniqueAgent();
  await assert.rejects(
    () =>
      authorizeRoosterSpend({
        agentId,
        offerId: "offer_x",
        destination: "rooster",
        currency: "ETH",
        amountCents: 1000,
      }),
    (err: unknown) => err instanceof CapabilityDeniedError && err.reason === "CURRENCY_NOT_ALLOWED",
  );
});

test("rejects funding an offer that is already SUBMITTED under a one-time capability", async () => {
  const agentId = uniqueAgent();
  const offerId = "offer_already_funded";
  const capability = await issueCapability({
    agentId,
    currency: "USDC",
    maxAmountCents: 2500,
    offerId,
    oneTime: true,
    ttlMinutes: 60,
  });

  const idempotencyKey = computeIdempotencyKey(agentId, offerId, "fund");
  await createPendingRecord({
    idempotencyKey,
    agentId,
    offerId,
    capability,
    network: "base-sepolia",
    amountCents: 2500,
    depositAddress: "0x0000000000000000000000000000000000dEaD",
  });
  // Simulate a completed submission (mirrors what the fund route does after
  // a successful adapter.fund() call).
  await updateRecordState(idempotencyKey, "SUBMITTED", { txHash: "0xabc" });

  await assert.rejects(
    () => authorizeRoosterSpend({ agentId, offerId, destination: "rooster", currency: "USDC", amountCents: 2500 }),
    (err: unknown) => err instanceof CapabilityDeniedError && err.reason === "ALREADY_FUNDED",
  );
});

test("rejects a non-positive amount", async () => {
  const agentId = uniqueAgent();
  const offerId = "offer_zero";
  await issueCapability({ agentId, currency: "USDC", maxAmountCents: 2500, offerId, oneTime: true, ttlMinutes: 60 });

  await assert.rejects(
    () => authorizeRoosterSpend({ agentId, offerId, destination: "rooster", currency: "USDC", amountCents: 0 }),
    (err: unknown) => err instanceof CapabilityDeniedError && err.reason === "INVALID_AMOUNT",
  );
});
