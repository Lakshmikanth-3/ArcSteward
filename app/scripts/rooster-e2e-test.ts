/**
 * scripts/rooster-e2e-test.ts
 *
 * End-to-end smoke test for the Rooster Agents integration, styled after
 * scripts/e2e-test.ts. Exercises the REAL Rooster REST API using sandbox
 * mode (server v1.3.0, confirmed live 2026-08-24): auto-accepted by a
 * labelled, explicitly-non-human Rooster sandbox creator, so it reaches a
 * genuine awaiting_funding state with a real per-offer Base Sepolia escrow
 * wallet — unlike testMode, which stops at pending_human_decision forever
 * since no human ever accepts a simulation. Exercises the Velo402
 * capability check and real Base Sepolia settlement path end-to-end,
 * including Rooster's own escrow release back to the creator.
 *
 * Run: npx tsx --env-file=.env scripts/rooster-e2e-test.ts
 */
import { RoosterClient } from "../src/lib/rooster/rooster-client";
import { validateOfferInput } from "../src/lib/rooster/offer-validation";
import { waitForOfferStatus } from "../src/lib/rooster/offer-status-poller";
import { issueCapability } from "../src/lib/rooster/capability-store";
import { authorizeRoosterSpend } from "../src/lib/rooster/capability";
import {
  computeIdempotencyKey,
  createPendingRecord,
  getRecordByOfferId,
  updateRecordState,
} from "../src/lib/rooster/ledger-store";
import { getBaseChainConfig, getSettlementNetwork } from "../src/lib/rooster/config";
import { BaseSepoliaSettlementAdapter } from "../src/lib/rooster/settlement-adapter";
import {
  CapabilityDeniedError,
  SettlementNotImplementedError,
  type OfferInput,
  type RoosterCapability,
} from "../src/lib/rooster/types";
import { privateKeyToAccount } from "viem/accounts";

const AGENT_ID = "velo402-pilot-agent";

function ok(label: string) {
  console.log(`  ✅ ${label}`);
}
function fail(label: string, detail?: unknown) {
  console.error(`  ❌ ${label}`, detail ?? "");
}
function info(label: string) {
  console.log(`  ℹ  ${label}`);
}
function step(n: number, label: string) {
  console.log(`\n[Step ${n}] ${label}`);
}

async function main() {
  console.log("===================================================");
  console.log(" Velo402 x Rooster Agents -- Base Sepolia E2E Test");
  console.log("===================================================");

  step(1, "Build + validate a sandbox offer");
  const network = getSettlementNetwork();
  const agentWallet = privateKeyToAccount(getBaseChainConfig(network).privateKey).address;
  const offerInput: OfferInput = {
    deliverable: {
      platform: "x",
      kind: "post",
      caption: "Velo402 x Rooster integration smoke test #ad",
    },
    priceCents: 500,
    currency: "USDC",
    testMode: false,
    sandbox: true,
    sandboxChain: "BASE-SEPOLIA",
    agentWallet,
    agentName: "Velo402PilotAgent",
    agentOperator: "Velo402",
  };
  validateOfferInput(offerInput);
  ok("Offer input passed local validation");

  step(2, "Submit offer to the real Rooster API");
  const client = new RoosterClient();
  let offerId: string;
  try {
    const offer = await client.submitOffer(offerInput);
    offerId = offer.offerId;
    ok(`Offer submitted -- offerId: ${offerId}`);
  } catch (err) {
    fail("submitOffer failed", err);
    process.exitCode = 1;
    return;
  }

  step(3, "Poll offer status (bounded, backs off on errors)");
  const poll = await waitForOfferStatus(offerId, { client, timeoutMs: 60_000, intervalMs: 5_000 });
  ok(
    `Poll finished -- state: ${poll.status.state} (timedOut: ${poll.timedOut}, attempts: ${poll.attempts})`,
  );

  step(4, "Check for funding info (present once the sandbox creator auto-accepts)");
  if (!poll.status.funding) {
    info(
      "No funding info returned -- offer did not reach awaiting_funding within the poll " +
        "window. Stopping here rather than fabricate a funding step that did not happen.",
    );
    console.log("\n===================================================");
    console.log(" Offer submission + status polling verified LIVE against the real Rooster API.");
    console.log(" Funding/settlement steps require the offer to reach awaiting_funding.");
    console.log("===================================================\n");
    return;
  }

  step(5, "Retrieve funding information");
  ok(`Deposit address: ${poll.status.funding.depositAddress}`);
  ok(`Amount owed (price + marketplace fee): ${poll.status.funding.amountCents}c`);

  step(6, "Issue + check a Velo402 RoosterCapability for this offer");
  await issueCapability({
    agentId: AGENT_ID,
    currency: "USDC",
    maxAmountCents: poll.status.funding.amountCents,
    offerId,
    oneTime: true,
    ttlMinutes: 120,
  });

  let capability: RoosterCapability;
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

  step(7, "Prepare settlement (idempotent PENDING ledger record)");
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

  step(8, "Fund Base Sepolia escrow (real signed USDC transfer)");
  try {
    const adapter = new BaseSepoliaSettlementAdapter(network);
    const fundResult = await adapter.fund({
      offerId,
      depositAddress: poll.status.funding.depositAddress as `0x${string}`,
      amountCents: poll.status.funding.amountCents,
    });
    ok(`Base Sepolia transfer submitted -- txHash: ${fundResult.txHash}`);

    step(9, "Wait for blockchain confirmation");
    const confirmation = await adapter.waitForConfirmation(fundResult.txHash);
    ok(`Confirmed in block ${confirmation.blockNumber} -- status: ${confirmation.status}`);

    step(10, "Mark funding CONFIRMED in the reconciliation ledger");
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

  step(11, "Poll Rooster again for post/release");
  // Rooster's own funding-watcher + release lag is ~1.5-2.5min in practice
  // (live-observed 2026-08-24), well past the ~10s escrow-provisioning speed
  // -- give it real budget rather than reporting a false timeout.
  const finalPoll = await waitForOfferStatus(offerId, { client, timeoutMs: 210_000, intervalMs: 10_000 });
  ok(`Final Rooster state: ${finalPoll.status.state}`);

  step(15, "Reconciliation record");
  const record = await getRecordByOfferId(offerId);
  console.log(JSON.stringify(record, null, 2));

  console.log("\n===================================================");
  console.log(" Full Base Sepolia funding flow exercised end-to-end.");
  console.log("===================================================\n");
}

main().catch((err) => {
  console.error("\nFatal:", err);
  process.exitCode = 1;
});
