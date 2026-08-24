import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOfferInput } from "../offer-validation";
import { RoosterValidationError, type OfferInput } from "../types";

function baseInput(overrides: Partial<OfferInput> = {}): OfferInput {
  return {
    creatorCode: "JESSICASMART",
    audience: "targeted",
    deliverable: {
      platform: "x",
      kind: "post",
      caption: "Check this out #ad",
    },
    priceCents: 2500,
    currency: "USDC",
    testMode: true,
    agentName: "TestAgent",
    ...overrides,
  };
}

test("accepts a valid test-mode targeted offer", () => {
  assert.doesNotThrow(() => validateOfferInput(baseInput()));
});

test("rejects missing creatorCode for targeted audience", () => {
  assert.throws(
    () => validateOfferInput(baseInput({ creatorCode: undefined })),
    RoosterValidationError,
  );
});

test("rejects creatorCode present on a board offer", () => {
  assert.throws(
    () => validateOfferInput(baseInput({ audience: "board", creatorCode: "X" })),
    RoosterValidationError,
  );
});

test("rejects invalid platform", () => {
  assert.throws(
    () =>
      validateOfferInput(
        baseInput({ deliverable: { platform: "myspace" as never, kind: "post", caption: "#ad" } }),
      ),
    RoosterValidationError,
  );
});

test("rejects invalid deliverable kind", () => {
  assert.throws(
    () =>
      validateOfferInput(
        baseInput({ deliverable: { platform: "x", kind: "carousel" as never, caption: "#ad" } }),
      ),
    RoosterValidationError,
  );
});

test("rejects caption missing #ad", () => {
  assert.throws(
    () =>
      validateOfferInput(
        baseInput({ deliverable: { platform: "x", kind: "post", caption: "No disclosure here" } }),
      ),
    RoosterValidationError,
  );
});

test("rejects empty caption", () => {
  assert.throws(
    () => validateOfferInput(baseInput({ deliverable: { platform: "x", kind: "post", caption: "" } })),
    RoosterValidationError,
  );
});

test("requires mediaUrl for instagram", () => {
  assert.throws(
    () =>
      validateOfferInput(
        baseInput({ deliverable: { platform: "instagram", kind: "reel", caption: "Hi #ad" } }),
      ),
    RoosterValidationError,
  );
  assert.doesNotThrow(() =>
    validateOfferInput(
      baseInput({
        deliverable: {
          platform: "instagram",
          kind: "reel",
          caption: "Hi #ad",
          mediaUrl: "https://example.com/img.png",
        },
      }),
    ),
  );
});

test("rejects link embedded directly in the caption body", () => {
  assert.throws(
    () =>
      validateOfferInput(
        baseInput({
          deliverable: {
            platform: "x",
            kind: "post",
            caption: "Check https://example.com out #ad",
            linkUrl: "https://example.com",
          },
        }),
      ),
    RoosterValidationError,
  );
});

test("rejects non-USDC currency", () => {
  assert.throws(
    () => validateOfferInput(baseInput({ currency: "USD" })),
    RoosterValidationError,
  );
});

test("allows $5 minimum in test mode", () => {
  assert.doesNotThrow(() => validateOfferInput(baseInput({ priceCents: 500, testMode: true })));
});

test("rejects below $5 even in test mode", () => {
  assert.throws(
    () => validateOfferInput(baseInput({ priceCents: 499, testMode: true })),
    RoosterValidationError,
  );
});

test("rejects below $25 for a real (non-test) offer", () => {
  assert.throws(
    () => validateOfferInput(baseInput({ priceCents: 2000, testMode: false })),
    RoosterValidationError,
  );
});

test("allows exactly $25 for a real offer", () => {
  assert.doesNotThrow(() => validateOfferInput(baseInput({ priceCents: 2500, testMode: false })));
});

test("rejects above the $50,000 maximum", () => {
  assert.throws(
    () => validateOfferInput(baseInput({ priceCents: 50_000_01, testMode: false })),
    RoosterValidationError,
  );
});

test("rejects non-boolean testMode", () => {
  assert.throws(
    () => validateOfferInput(baseInput({ testMode: "true" as unknown as boolean })),
    RoosterValidationError,
  );
});

test("rejects missing agentName", () => {
  assert.throws(() => validateOfferInput(baseInput({ agentName: "" })), RoosterValidationError);
});

test("aggregates multiple issues in a single error", () => {
  try {
    validateOfferInput(
      baseInput({
        creatorCode: undefined,
        priceCents: -5,
        agentName: "",
      }),
    );
    assert.fail("expected validateOfferInput to throw");
  } catch (err) {
    assert.ok(err instanceof RoosterValidationError);
    assert.ok((err as RoosterValidationError).issues.length >= 3);
  }
});
