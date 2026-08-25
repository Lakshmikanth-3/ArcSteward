import { test } from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { RoosterClient } from "../rooster-client";
import { issueCapability } from "../capability-store";
import { getRecordByOfferId } from "../ledger-store";
import { CapabilityDeniedError } from "../types";
import type { SettlementNetwork } from "../config";
import type { SettlementAdapter } from "../settlement-adapter";
import { handleFundRequest } from "../../../app/api/rooster/offers/[offerId]/fund/route";

process.env.ROOSTER_CAPABILITY_STORE_PATH = path.join(
  os.tmpdir(),
  `rooster-capabilities-fundroute-test-${process.pid}-${Date.now()}.json`,
);
process.env.ROOSTER_LEDGER_STORE_PATH = path.join(
  os.tmpdir(),
  `rooster-ledger-fundroute-test-${process.pid}-${Date.now()}.json`,
);
// Force the FileStore fallback regardless of the ambient environment.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;

const FAKE_CONFIG = { baseUrl: "https://roosteragents.ai/agent-economy", apiKey: "rae_live_x", testMode: true };

let counter = 0;
function unique(prefix: string): string {
  counter += 1;
  return `${prefix}-${process.pid}-${counter}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeClient(fundingAmountCents = 2500, depositAddress = "0xDEAD"): RoosterClient {
  const fetchImpl = (async () =>
    jsonResponse({
      lifecycle: "awaiting_funding",
      terminal: false,
      status: "awaiting_funding",
      funding: { depositAddress, amountUsdcCents: fundingAmountCents, currency: "USDC" },
    })) as typeof fetch;
  return new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });
}

function makeAdapter(opts: {
  confirmationStatus?: "confirmed" | "failed";
  txHash?: string;
  fundError?: Error;
} = {}): { adapter: SettlementAdapter; calls: { fund: number; waitForConfirmation: number } } {
  const calls = { fund: 0, waitForConfirmation: 0 };
  const adapter: SettlementAdapter = {
    async fund() {
      calls.fund += 1;
      if (opts.fundError) throw opts.fundError;
      return { txHash: (opts.txHash ?? "0xfundtx") as `0x${string}`, network: "base-sepolia" as SettlementNetwork };
    },
    async waitForConfirmation() {
      calls.waitForConfirmation += 1;
      return {
        status: opts.confirmationStatus ?? "confirmed",
        blockNumber: 12345n,
        confirmations: 1,
      };
    },
    async bridgeFromSui(): Promise<never> {
      throw new Error("not exercised by these tests");
    },
  };
  return { adapter, calls };
}

test("confirmation success transitions the ledger to CONFIRMED", async () => {
  const agentId = unique("agent");
  const offerId = unique("offer");
  await issueCapability({ agentId, currency: "USDC", maxAmountCents: 2500, offerId, oneTime: true, ttlMinutes: 60 });

  const client = makeClient(2500);
  const { adapter, calls } = makeAdapter({ confirmationStatus: "confirmed" });

  const result = await handleFundRequest(offerId, { agentId }, { client, adapter });

  assert.equal(result.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.replay, false);
  assert.equal(result.body.record?.state, "CONFIRMED");
  assert.equal(calls.fund, 1);
  assert.equal(calls.waitForConfirmation, 1);
});

test("chain-reported confirmation failure transitions the ledger to FAILED, preserves txHash, and does not reuse the pre-broadcast error message", async () => {
  const agentId = unique("agent");
  const offerId = unique("offer");
  await issueCapability({ agentId, currency: "USDC", maxAmountCents: 2500, offerId, oneTime: true, ttlMinutes: 60 });

  const client = makeClient(2500);
  const { adapter } = makeAdapter({ confirmationStatus: "failed", txHash: "0xfailedtx" });

  const result = await handleFundRequest(offerId, { agentId }, { client, adapter });

  assert.equal(result.status, 502);
  assert.equal(result.body.ok, false);
  assert.ok(result.body.error?.includes("failed on-chain"));
  assert.equal(result.body.record?.state, "FAILED");
  assert.equal(result.body.record?.txHash, "0xfailedtx");
  assert.ok(result.body.record?.error?.includes("block"));
});

test("a second call for the same agent/offer replays the cached outcome and never calls the adapter again (idempotent)", async () => {
  const agentId = unique("agent");
  const offerId = unique("offer");
  await issueCapability({ agentId, currency: "USDC", maxAmountCents: 2500, offerId, oneTime: true, ttlMinutes: 60 });

  const client = makeClient(2500);
  const { adapter, calls } = makeAdapter({ confirmationStatus: "confirmed" });

  const first = await handleFundRequest(offerId, { agentId }, { client, adapter });
  const second = await handleFundRequest(offerId, { agentId }, { client, adapter });

  assert.equal(first.body.replay, false);
  assert.equal(second.body.replay, true);
  assert.equal(second.body.record?.state, "CONFIRMED");
  // The adapter must NOT have been invoked a second time.
  assert.equal(calls.fund, 1);
  assert.equal(calls.waitForConfirmation, 1);
});

test("missing deposit address is rejected with 409 and zero side effects (no ledger record created)", async () => {
  const agentId = unique("agent");
  const offerId = unique("offer");
  await issueCapability({ agentId, currency: "USDC", maxAmountCents: 2500, offerId, oneTime: true, ttlMinutes: 60 });

  const fetchImpl = (async () =>
    jsonResponse({
      lifecycle: "awaiting_funding",
      terminal: false,
      funding: { depositAddress: "", amountUsdcCents: 2500 },
    })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });
  const { adapter, calls } = makeAdapter();

  const result = await handleFundRequest(offerId, { agentId }, { client, adapter });

  assert.equal(result.status, 409);
  assert.equal(result.body.ok, false);
  assert.equal(calls.fund, 0);
  assert.equal(calls.waitForConfirmation, 0);
  assert.equal(await getRecordByOfferId(offerId), undefined);
});

test("a funding amount over the capability ceiling is denied with 403 and never reaches the adapter", async () => {
  const agentId = unique("agent");
  const offerId = unique("offer");
  await issueCapability({ agentId, currency: "USDC", maxAmountCents: 2000, offerId, oneTime: true, ttlMinutes: 60 });

  // Live funding amount ($30) exceeds the issued capability ceiling ($20).
  const client = makeClient(3000);
  const { adapter, calls } = makeAdapter();

  await assert.rejects(
    () => handleFundRequest(offerId, { agentId }, { client, adapter }),
    (err: unknown) => err instanceof CapabilityDeniedError && err.reason === "OVER_BUDGET",
  );
  assert.equal(calls.fund, 0);
});

test("agentId is required", async () => {
  const client = makeClient();
  const { adapter } = makeAdapter();
  const result = await handleFundRequest("offer-no-agent", {}, { client, adapter });
  assert.equal(result.status, 400);
  assert.equal(result.body.ok, false);
});
