import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTENTION_LIFECYCLE_VALUES,
  REFUND_LIFECYCLE_VALUES,
  SUCCESS_LIFECYCLE_VALUES,
  TERMINAL_LIFECYCLE_VALUES,
  classifyLifecycleOutcome,
  type OfferLifecycle,
} from "../types";

// The full 17-value union plus "unknown", spelled out so a new Rooster
// lifecycle value shows up here as a deliberate addition, not silently.
const ALL_LIFECYCLE_VALUES: OfferLifecycle[] = [
  "pending_human_decision",
  "countered",
  "rejected",
  "expired",
  "accepted",
  "provisioning_escrow",
  "awaiting_funding",
  "funded_delivery_in_progress",
  "post_failed_refund_pending",
  "delivered_awaiting_creator_wallet",
  "releasing",
  "completed",
  "refunded",
  "refund_failed",
  "expired_unfunded",
  "escrow_error",
  "test_completed_simulated",
  "unknown",
];

test("SUCCESS/REFUND/ATTENTION lifecycle Sets are each a subset of TERMINAL_LIFECYCLE_VALUES", () => {
  for (const set of [SUCCESS_LIFECYCLE_VALUES, REFUND_LIFECYCLE_VALUES, ATTENTION_LIFECYCLE_VALUES]) {
    for (const value of set) {
      assert.ok(TERMINAL_LIFECYCLE_VALUES.has(value), `${value} must also be in TERMINAL_LIFECYCLE_VALUES`);
    }
  }
});

test("SUCCESS/REFUND/ATTENTION lifecycle Sets are pairwise disjoint", () => {
  const sets = [SUCCESS_LIFECYCLE_VALUES, REFUND_LIFECYCLE_VALUES, ATTENTION_LIFECYCLE_VALUES];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      for (const value of sets[i]) {
        assert.ok(!sets[j].has(value), `${value} must not appear in more than one outcome Set`);
      }
    }
  }
});

test("classifyLifecycleOutcome: completed and test_completed_simulated are success", () => {
  assert.equal(classifyLifecycleOutcome("completed"), "success");
  assert.equal(classifyLifecycleOutcome("test_completed_simulated"), "success");
});

test("classifyLifecycleOutcome: refunded is refund_success", () => {
  assert.equal(classifyLifecycleOutcome("refunded"), "refund_success");
});

test("classifyLifecycleOutcome: refund_failed and escrow_error are attention_required", () => {
  assert.equal(classifyLifecycleOutcome("refund_failed"), "attention_required");
  assert.equal(classifyLifecycleOutcome("escrow_error"), "attention_required");
});

test("classifyLifecycleOutcome: benign terminal declines (rejected/expired/expired_unfunded) are pending, not attention_required", () => {
  // These are terminal — no money at risk, nothing stuck — deliberately NOT
  // bucketed with refund_failed/escrow_error, which mean something needs a
  // human to look at it.
  assert.equal(classifyLifecycleOutcome("rejected"), "pending");
  assert.equal(classifyLifecycleOutcome("expired"), "pending");
  assert.equal(classifyLifecycleOutcome("expired_unfunded"), "pending");
});

test("classifyLifecycleOutcome: every non-terminal value is pending", () => {
  for (const value of ALL_LIFECYCLE_VALUES) {
    if (!TERMINAL_LIFECYCLE_VALUES.has(value)) {
      assert.equal(classifyLifecycleOutcome(value), "pending", `${value} should classify as pending`);
    }
  }
});

test("classifyLifecycleOutcome never throws for any known lifecycle value, including 'unknown'", () => {
  for (const value of ALL_LIFECYCLE_VALUES) {
    assert.doesNotThrow(() => classifyLifecycleOutcome(value));
  }
  assert.equal(classifyLifecycleOutcome("unknown"), "pending");
});
