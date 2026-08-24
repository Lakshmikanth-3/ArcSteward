/**
 * scripts/rooster-refund-test.ts
 *
 * Refund-path smoke test: submit/fund a test offer, then poll for a
 * "refunded" terminal state and reconcile it.
 *
 * IMPORTANT HONESTY NOTE: triggering an actual refund requires a real,
 * human-accepted, funded offer where the creator's post is later judged
 * unverifiable by Rooster -- none of which is possible in testMode (which
 * bypasses human contact and posting entirely). This script cannot force
 * that outcome; it documents and checks for it, and reports plainly if the
 * refund state was never reached rather than pretending it was.
 *
 * Run: npx tsx --env-file=.env scripts/rooster-refund-test.ts
 */
import { RoosterClient } from "../src/lib/rooster/rooster-client";
import { waitForOfferStatus } from "../src/lib/rooster/offer-status-poller";
import {
  computeIdempotencyKey,
  getRecord,
  updateRecordState,
} from "../src/lib/rooster/ledger-store";
import type { OfferInput } from "../src/lib/rooster/types";

const AGENT_ID = "velo402-pilot-agent";

function ok(label: string) {
  console.log(`  ✅ ${label}`);
}
function info(label: string) {
  console.log(`  ℹ  ${label}`);
}
function fail(label: string, detail?: unknown) {
  console.error(`  ❌ ${label}`, detail ?? "");
}
function step(n: number, label: string) {
  console.log(`\n[Step ${n}] ${label}`);
}

async function main() {
  console.log("===================================================");
  console.log(" Velo402 x Rooster Agents -- Refund Path Smoke Test");
  console.log("===================================================");

  step(1, "Create a test offer");
  const offerInput: OfferInput = {
    creatorCode: "JESSICASMART",
    audience: "targeted",
    deliverable: { platform: "x", kind: "post", caption: "Refund path smoke test #ad" },
    priceCents: 2500,
    currency: "USDC",
    testMode: true,
    agentName: "Velo402PilotAgent",
  };
  const client = new RoosterClient();
  const offer = await client.submitOffer(offerInput);
  ok(`Offer submitted -- offerId: ${offer.offerId}`);

  step(2, "Poll for a terminal state, watching specifically for 'refunded'");
  const poll = await waitForOfferStatus(offer.offerId, {
    client,
    timeoutMs: 60_000,
    intervalMs: 5_000,
  });
  ok(`Final state observed: ${poll.status.state}`);

  step(3, "Detect refund");
  if (poll.status.state !== "refunded") {
    info(
      `Offer never reached "refunded" (ended at "${poll.status.state}"). This is expected for a ` +
        "testMode offer -- Rooster never contacts a human or posts, so there is nothing for it to " +
        "refund. A real refund can only be exercised against a real, funded, human-accepted offer " +
        "whose post is later judged unverifiable.",
    );
    console.log("\n===================================================");
    console.log(" Refund detection logic is wired up and polls correctly;");
    console.log(" no real refund was triggered because none is possible in testMode.");
    console.log("===================================================\n");
    return;
  }

  step(4, "Verify refund transaction");
  if (poll.status.refundTxHash) {
    ok(`Rooster reported refundTx: ${poll.status.refundTxHash} -- verify on a Base Sepolia block explorer.`);
  } else {
    info(
      "Rooster's offer-status response did not include a refundTx for this offer. Verify the " +
        "incoming refund against the settlement wallet's Base Sepolia transaction history via a " +
        "block explorer instead.",
    );
  }

  step(5, "Reconcile the original offer as REFUNDED");
  const idempotencyKey = computeIdempotencyKey(AGENT_ID, offer.offerId, "fund");
  const existing = await getRecord(idempotencyKey);
  if (!existing) {
    fail(`No local reconciliation record found for offer ${offer.offerId} -- was it ever funded via this tool?`);
    process.exitCode = 1;
    return;
  }
  const updated = await updateRecordState(idempotencyKey, "REFUNDED");
  ok(`Reconciliation record updated -- state: ${updated.state}`);

  console.log("\n===================================================");
  console.log(" Refund reconciled.");
  console.log("===================================================\n");
}

main().catch((err) => {
  console.error("\nFatal:", err);
  process.exitCode = 1;
});
