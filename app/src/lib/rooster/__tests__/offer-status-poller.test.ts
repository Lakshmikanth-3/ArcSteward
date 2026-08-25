import { test } from "node:test";
import assert from "node:assert/strict";
import { waitForOfferStatus } from "../offer-status-poller";
import { RoosterClient } from "../rooster-client";

const FAKE_CONFIG = { baseUrl: "https://roosteragents.ai/agent-economy", apiKey: "rae_live_x", testMode: true };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function makeFakeClock(startMs = 0) {
  let current = startMs;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

test("resolves immediately when the first poll returns a terminal state", async () => {
  const fetchImpl = (async () => jsonResponse({ status: "released" })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });
  const clock = makeFakeClock();

  const result = await waitForOfferStatus("offer_1", {
    client,
    now: clock.now,
    sleep: clock.sleep,
    timeoutMs: 60_000,
    intervalMs: 1000,
  });

  assert.equal(result.timedOut, false);
  assert.equal(result.attempts, 1);
  assert.equal(result.status.state, "released");
});

test("stops polling on lifecycle.terminal even for a state the old TERMINAL_OFFER_STATES set wouldn't recognize", async () => {
  // "escrow_error" is a new lifecycle-only terminal value with no equivalent
  // in the legacy OfferState — proves the poller switched to trusting
  // `terminal` directly rather than re-deriving it from `state`.
  const fetchImpl = (async () =>
    jsonResponse({ status: "some_unmapped_state", lifecycle: "escrow_error", terminal: true })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });
  const clock = makeFakeClock();

  const result = await waitForOfferStatus("offer_1", {
    client,
    now: clock.now,
    sleep: clock.sleep,
    timeoutMs: 60_000,
    intervalMs: 1000,
  });

  assert.equal(result.timedOut, false);
  assert.equal(result.attempts, 1);
  assert.equal(result.status.lifecycle, "escrow_error");
});

test("polls repeatedly until a terminal state is reached", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({ status: calls < 3 ? "awaiting_funding" : "released" });
  }) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });
  const clock = makeFakeClock();

  const result = await waitForOfferStatus("offer_1", {
    client,
    now: clock.now,
    sleep: clock.sleep,
    timeoutMs: 60_000,
    intervalMs: 1000,
  });

  assert.equal(calls, 3);
  assert.equal(result.timedOut, false);
  assert.equal(result.status.state, "released");
});

test("times out and preserves the last known non-terminal state", async () => {
  const fetchImpl = (async () => jsonResponse({ status: "awaiting_funding" })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });
  const clock = makeFakeClock();

  const result = await waitForOfferStatus("offer_1", {
    client,
    now: clock.now,
    sleep: clock.sleep,
    timeoutMs: 10_000,
    intervalMs: 2000,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.status.state, "awaiting_funding");
  assert.ok(result.attempts >= 1);
});

test("backs off on repeated errors and times out without throwing", async () => {
  const fetchImpl = (async () => jsonResponse({ error: "boom" }, 500)) as typeof fetch;
  // maxRetries: 0 so each getOfferStatus call itself fails fast -> exercises the poller's own error handling.
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0, maxRetries: 0 });
  const clock = makeFakeClock();

  const result = await waitForOfferStatus("offer_1", {
    client,
    now: clock.now,
    sleep: clock.sleep,
    timeoutMs: 30_000,
    intervalMs: 1000,
  });

  assert.equal(result.timedOut, true);
  assert.equal(result.status.state, "unknown");
});

test("respects timeoutMs — does not exceed it by more than one interval", async () => {
  const fetchImpl = (async () => jsonResponse({ status: "awaiting_funding" })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });
  const clock = makeFakeClock();

  await waitForOfferStatus("offer_1", {
    client,
    now: clock.now,
    sleep: clock.sleep,
    timeoutMs: 5_000,
    intervalMs: 1000,
  });

  assert.ok(clock.now() <= 5_000 + 1000, `clock advanced too far: ${clock.now()}`);
});
