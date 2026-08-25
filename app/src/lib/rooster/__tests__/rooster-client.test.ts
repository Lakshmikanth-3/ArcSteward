import { test } from "node:test";
import assert from "node:assert/strict";
import { RoosterClient } from "../rooster-client";
import { RoosterApiError } from "../types";

const FAKE_CONFIG = { baseUrl: "https://roosteragents.ai/agent-economy", apiKey: "rae_live_SECRET123", testMode: true };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("submitOffer sends the Authorization header and flattens the deliverable", async () => {
  let capturedRequest: { url: string; init: RequestInit } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    capturedRequest = { url: String(url), init };
    return jsonResponse({ offerId: "offer_abc123" });
  }) as typeof fetch;

  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });
  const offer = await client.submitOffer({
    creatorCode: "JESSICASMART",
    audience: "targeted",
    deliverable: { platform: "x", kind: "post", caption: "Hello #ad" },
    priceCents: 2500,
    currency: "USDC",
    testMode: true,
    agentName: "TestAgent",
  });

  assert.equal(offer.offerId, "offer_abc123");
  assert.ok(capturedRequest);
  assert.equal(capturedRequest!.url, "https://roosteragents.ai/agent-economy/offer");
  const headers = capturedRequest!.init.headers as Record<string, string>;
  assert.equal(headers.Authorization, "Bearer rae_live_SECRET123");

  const body = JSON.parse(capturedRequest!.init.body as string);
  assert.equal(body.platform, "x");
  assert.equal(body.kind, "post");
  assert.equal(body.caption, "Hello #ad");
  assert.equal(body.deliverable, undefined); // flattened, not nested
});

test("never leaks the Authorization header value in a thrown error", async () => {
  const fetchImpl = (async () => jsonResponse({ error: "invalid" }, 401)) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });

  await assert.rejects(
    () => client.getOfferStatus("offer_x"),
    (err: unknown) => {
      assert.ok(err instanceof RoosterApiError);
      assert.ok(!String(err.message).includes(FAKE_CONFIG.apiKey));
      assert.ok(!JSON.stringify(err).includes(FAKE_CONFIG.apiKey));
      return true;
    },
  );
});

test("retries once on HTTP 500 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ error: "server error" }, 500);
    return jsonResponse({ offerId: "offer_retry" });
  }) as typeof fetch;

  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0, maxRetries: 2 });
  const offer = await client.submitOffer({
    creatorCode: "JESSICASMART",
    deliverable: { platform: "x", kind: "post", caption: "Hi #ad" },
    priceCents: 2500,
    currency: "USDC",
    testMode: true,
    agentName: "TestAgent",
  });

  assert.equal(calls, 2);
  assert.equal(offer.offerId, "offer_retry");
});

test("does not retry on HTTP 400 (client error, not transient)", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    return jsonResponse({ error: "bad request" }, 400);
  }) as typeof fetch;

  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0, maxRetries: 2 });
  await assert.rejects(() => client.getOfferStatus("offer_x"), RoosterApiError);
  assert.equal(calls, 1);
});

test("submitOffer throws if the response has no offer id", async () => {
  const fetchImpl = (async () => jsonResponse({ ok: true })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });

  await assert.rejects(
    () =>
      client.submitOffer({
        creatorCode: "X",
        deliverable: { platform: "x", kind: "post", caption: "#ad" },
        priceCents: 2500,
        currency: "USDC",
        testMode: true,
        agentName: "TestAgent",
      }),
    RoosterApiError,
  );
});

test("getOfferStatus normalizes a recognized state and parses funding info", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      status: "awaiting_funding",
      funding: {
        depositAddress: "0xDEAD",
        amountCents: 2875,
        currency: "USDC",
        deadline: "2026-08-27T00:00:00Z",
      },
    })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });

  const status = await client.getOfferStatus("offer_x");
  assert.equal(status.state, "awaiting_funding");
  assert.equal(status.funding?.depositAddress, "0xDEAD");
  assert.equal(status.funding?.amountCents, 2875);
});

test("getOfferStatus unwraps the real { ok, offer: {...} } envelope Rooster actually returns", async () => {
  // Shape confirmed live against the real Rooster API (2026-08-24), not guessed.
  const fetchImpl = (async () =>
    jsonResponse({
      ok: true,
      offer: {
        offerId: "q97d4je7dbk9722q00h6r3zzy18d2pb3",
        status: "posted_simulated",
        testMode: true,
        funding: null,
        refundTx: null,
        releaseTx: null,
        decisionNote: "SIMULATED acceptance — test mode. No human contacted, nothing posted, no money moved.",
      },
    })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });

  const status = await client.getOfferStatus("q97d4je7dbk9722q00h6r3zzy18d2pb3");
  assert.equal(status.state, "posted_simulated");
  assert.equal(status.funding, undefined);
  assert.equal(status.refundTxHash, undefined);
});

test("getOfferStatus trusts Rooster's authoritative lifecycle/terminal fields when present", async () => {
  // Shape confirmed live 2026-08-25 after Rooster's server-side fix — `status`
  // still freezes at "posted", but `lifecycle`/`terminal` now report the truth.
  const fetchImpl = (async () =>
    jsonResponse({
      offer: {
        status: "posted",
        escrowStatus: "released",
        lifecycle: "completed",
        terminal: true,
        releaseTx: "0xabc",
      },
    })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });

  const status = await client.getOfferStatus("offer_x");
  assert.equal(status.lifecycle, "completed");
  assert.equal(status.terminal, true);
  assert.equal(status.state, "released"); // legacy field still derived from escrowStatus
});

test("getOfferStatus falls back to state-derived terminal when lifecycle/terminal are absent", async () => {
  const fetchImpl = (async () => jsonResponse({ status: "released" })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });

  const status = await client.getOfferStatus("offer_x");
  assert.equal(status.lifecycle, "unknown");
  assert.equal(status.terminal, true); // "released" is in TERMINAL_OFFER_STATES
});

test("getOfferStatus maps an unrecognized lifecycle string to 'unknown' instead of throwing", async () => {
  const fetchImpl = (async () =>
    jsonResponse({ status: "awaiting_funding", lifecycle: "some_future_lifecycle_we_havent_seen" })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });

  const status = await client.getOfferStatus("offer_x");
  assert.equal(status.lifecycle, "unknown");
});

test("getOfferStatus parses funding.amountUsdcCents (Rooster's new integer-cents shape)", async () => {
  const fetchImpl = (async () =>
    jsonResponse({
      status: "awaiting_funding",
      funding: { depositAddress: "0xDEAD", amountUsdcCents: 575, currency: "USDC" },
    })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });

  const status = await client.getOfferStatus("offer_x");
  assert.equal(status.funding?.amountCents, 575);
});

test("getOfferStatus maps an unrecognized state string to 'unknown' instead of throwing", async () => {
  const fetchImpl = (async () => jsonResponse({ status: "some_future_state_we_havent_seen" })) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });

  const status = await client.getOfferStatus("offer_x");
  assert.equal(status.state, "unknown");
});

test("listCreators parses the real shape: 'creator' code field and platform connection objects", async () => {
  // Shape confirmed live against the real creators.json (2026-08-24).
  const fetchImplArray = (async () =>
    jsonResponse([
      {
        creator: "JESSICASMART",
        platforms: [
          { network: "instagram", handle: "@x", followers: 100 },
          { network: "tiktok", handle: "@x", followers: 50 },
        ],
      },
    ])) as typeof fetch;
  const clientArray = new RoosterClient({ config: FAKE_CONFIG, fetchImpl: fetchImplArray, minIntervalMs: 0 });
  const creators = await clientArray.listCreators();
  assert.deepEqual(creators.map((c) => c.code), ["JESSICASMART"]);
  assert.deepEqual(creators[0].platforms, ["instagram", "tiktok"]);

  const fetchImplEnvelope = (async () =>
    jsonResponse({ creators: [{ creator: "OTHERCODE", platforms: [{ network: "x" }] }] })) as typeof fetch;
  const clientEnvelope = new RoosterClient({ config: FAKE_CONFIG, fetchImpl: fetchImplEnvelope, minIntervalMs: 0 });
  assert.deepEqual((await clientEnvelope.listCreators()).map((c) => c.code), ["OTHERCODE"]);
});

test("listCreators filters by platform", async () => {
  const fetchImpl = (async () =>
    jsonResponse([
      { creator: "A", platforms: [{ network: "instagram" }] },
      { creator: "B", platforms: [{ network: "tiktok" }] },
    ])) as typeof fetch;
  const client = new RoosterClient({ config: FAKE_CONFIG, fetchImpl, minIntervalMs: 0 });
  const filtered = await client.listCreators("tiktok");
  assert.deepEqual(filtered.map((c) => c.code), ["B"]);
});

test("constructor rejects a non-HTTPS base URL", () => {
  assert.throws(() => new RoosterClient({ config: { ...FAKE_CONFIG, baseUrl: "http://evil.example" } }));
});
