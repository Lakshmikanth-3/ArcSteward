/**
 * scripts/rooster-refund-test.ts
 *
 * Refund-path smoke test for the Rooster Agents integration. Uses sandbox
 * mode with sandboxOutcome: "refund" (server v1.3.0, confirmed live
 * 2026-08-24): the sandbox creator auto-accepts, we fund the real per-offer
 * Base Sepolia escrow, the post is then forced to fail, and 100% of what was
 * sent (offer + marketplace fee) is returned to agentWallet -- no cut taken.
 *
 * Mirrors scripts/rooster-e2e-test.ts up through funding, then watches for
 * "refunded" instead of "released".
 *
 * Run: npx tsx --env-file=.env scripts/rooster-refund-test.ts
 */
import { RoosterClient } from "../src/lib/rooster/rooster-client";
import { validateOfferInput } from "../src/lib/rooster/offer-validation";
import { waitForOfferStatus } from "../src/lib/rooster/offer-status-poller";
import { issueCapability } from "../src/lib/rooster/capability-store";
import { authorizeRoosterSpend } from "../src/lib/rooster/capability";
import {
  computeIdempotencyKey,
  createPendingRecord,
  updateRecordState,
} from "../src/lib/rooster/ledger-store";
import { getBaseChainConfig, getSettlementNetwork } from "../src/lib/rooster/config";
import { BaseSepoliaSettlementAdapter } from "../src/lib/rooster/settlement-adapter";
import {
  CapabilityDeniedError,
  SettlementNotImplementedError,
  type OfferInput,
} from "../src/lib/rooster/types";
import { privateKeyToAccount } from "viem/accounts";

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

  const network = getSettlementNetwork();
  const agentWallet = privateKeyToAccount(getBaseChainConfig(network).privateKey).address;

  step(1, "Build + validate a sandbox offer forced to refund");
  const offerInput: OfferInput = {
    deliverable: { platform: "x", kind: "post", caption: "Refund path smoke test #ad" },
    priceCents: 500,
    currency: "USDC",
    testMode: false,
    sandbox: true,
    sandboxChain: "BASE-SEPOLIA",
    sandboxOutcome: "refund",
    agentWallet,
    agentName: "Velo402PilotAgent",
    agentOperator: "Velo402",
  };
  validateOfferInput(offerInput);
  ok("Offer input passed local validation");

  step(2, "Submit offer to the real Rooster API");
  const client = new RoosterClient();
  const offer = await client.submitOffer(offerInput);
  const offerId = offer.offerId;
  ok(`Offer submitted -- offerId: ${offerId}`);

  step(3, "Poll for funding info (present once the sandbox creator auto-accepts)");
  const poll = await waitForOfferStatus(offerId, { client, timeoutMs: 60_000, intervalMs: 5_000 });
  ok(`Poll finished -- state: ${poll.status.state} (attempts: ${poll.attempts})`);

  if (!poll.status.funding) {
    info(
      "No funding info returned -- offer did not reach awaiting_funding within the poll window. " +
        "Stopping here rather than fabricate a funding step that did not happen.",
    );
    process.exitCode = 1;
    return;
  }
  ok(`Deposit address: ${poll.status.funding.depositAddress}`);
  ok(`Amount owed (price + marketplace fee): ${poll.status.funding.amountCents}c`);

  step(4, "Issue + check a Velo402 RoosterCapability for this offer");
  await issueCapability({
    agentId: AGENT_ID,
    currency: "USDC",
    maxAmountCents: poll.status.funding.amountCents,
    offerId,
    oneTime: true,
    ttlMinutes: 120,
  });

  let capability;
  try {
    const result = await authorizeRoosterSpend({
      agentId: AGENT_ID,
      offerId,
      destination: "rooster",
      currency: poll.status.funding.currency,
      amountCents: poll.status.funding.amountCents,
    });
    capability = result.capability;
    ok(`Capability check passed -- ceiling ${capability.maxAmountCents}c, expires ${capability.expiresAt}`);
  } catch (err) {
    if (err instanceof CapabilityDeniedError) {
      fail(`Capability denied: ${err.reason}`, err.message);
    } else {
      fail("Capability check threw unexpectedly", err);
    }
    process.exitCode = 1;
    return;
  }

  step(5, "Prepare settlement (idempotent PENDING ledger record)");
  const idempotencyKey = computeIdempotencyKey(AGENT_ID, offerId, "fund");
  await createPendingRecord({
    idempotencyKey,
    agentId: AGENT_ID,
    offerId,
    capability,
    network,
    amountCents: poll.status.funding.amountCents,
    depositAddress: poll.status.funding.depositAddress,
  });
  ok(`PENDING reconciliation record created -- idempotencyKey: ${idempotencyKey.slice(0, 16)}...`);

  step(6, "Fund Base Sepolia escrow (real signed USDC transfer)");
  try {
    const adapter = new BaseSepoliaSettlementAdapter(network);
    const fundResult = await adapter.fund({
      offerId,
      depositAddress: poll.status.funding.depositAddress as `0x${string}`,
      amountCents: poll.status.funding.amountCents,
    });
    ok(`Base Sepolia transfer submitted -- txHash: ${fundResult.txHash}`);

    step(7, "Wait for blockchain confirmation");
    const confirmation = await adapter.waitForConfirmation(fundResult.txHash);
    ok(`Confirmed in block ${confirmation.blockNumber} -- status: ${confirmation.status}`);

    step(8, "Mark funding CONFIRMED in the reconciliation ledger");
    const finalState = confirmation.status === "confirmed" ? "CONFIRMED" : "FAILED";
    await updateRecordState(idempotencyKey, finalState, { txHash: fundResult.txHash });
    ok(`Ledger updated -- state: ${finalState}`);
  } catch (err) {
    if (err instanceof SettlementNotImplementedError) {
      info(`Settlement adapter not usable: ${err.message}`);
      process.exitCode = 1;
      return;
    }
    fail("Settlement failed", err);
    process.exitCode = 1;
    return;
  }

  step(9, "Poll Rooster again, watching for the forced 'refunded' terminal state");
  // Same funding-watcher lag as the release leg (~1.5-2.5min live-observed
  // 2026-08-24) -- give it real budget rather than reporting a false timeout.
  const finalPoll = await waitForOfferStatus(offerId, { client, timeoutMs: 210_000, intervalMs: 10_000 });
  ok(`Final Rooster state: ${finalPoll.status.state}`);

  if (finalPoll.status.state !== "refunded") {
    info(
      `Offer never reached "refunded" (ended at "${finalPoll.status.state}", timedOut: ${finalPoll.timedOut}). ` +
        "Reporting plainly rather than pretending the refund happened.",
    );
    console.log("\n===================================================");
    console.log(" Funding leg verified LIVE; refund was not observed within the poll window.");
    console.log("===================================================\n");
    process.exitCode = 1;
    return;
  }

  step(10, "Verify refund transaction");
  if (finalPoll.status.refundTxHash) {
    ok(`Rooster reported refundTx: ${finalPoll.status.refundTxHash}`);
  } else {
    info(
      "Rooster's offer-status response did not include a refundTx for this offer. Verify the " +
        "incoming refund against the settlement wallet's Base Sepolia transaction history instead.",
    );
  }

  step(11, "Reconcile the original offer as REFUNDED");
  const updated = await updateRecordState(idempotencyKey, "REFUNDED");
  ok(`Reconciliation record updated -- state: ${updated.state}`);

  console.log("\n===================================================");
  console.log(" Refund path exercised end-to-end and reconciled.");
  console.log("===================================================\n");
}

main().catch((err) => {
  console.error("\nFatal:", err);
  process.exitCode = 1;
});
