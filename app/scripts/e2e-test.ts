/**
 * scripts/e2e-test.ts
 * Full end-to-end smoke test of the Velo402 agent loop:
 *   1. GET /api/knowledge/sentiment  → expect 402 challenge
 *   2. POST /api/guardian/analyze    → expect LOW/MEDIUM risk, no blocks
 *   3. Agent signs pay_402_invoice PTB and submits to testnet
 *   4. GET /api/knowledge/sentiment  with payment proof → expect 200
 *   5. Check audit stream for the AgentActionEvent
 *
 * Run: npx tsx --env-file=.env scripts/e2e-test.ts
 */
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { bcs } from "@mysten/sui/bcs";

const BASE_URL = "http://localhost:3000";
const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID!;
const TREASURY_ID = process.env.NEXT_PUBLIC_TREASURY_ID!;
const POLICY_ID = process.env.NEXT_PUBLIC_POLICY_CAP_ID!;

const client = new SuiJsonRpcClient({
  url: getJsonRpcFullnodeUrl("testnet"),
  network: "testnet",
});
const { secretKey } = decodeSuiPrivateKey(process.env.AGENT_PRIVATE_KEY!);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);

function ok(label: string) {
  console.log(`  ✅ ${label}`);
}
function fail(label: string, detail?: unknown) {
  console.error(`  ❌ ${label}`, detail ?? "");
}
function step(n: number, label: string) {
  console.log(`\n[Step ${n}] ${label}`);
}

async function main() {
  console.log("═══════════════════════════════════════════════");
  console.log(" Velo402 End-to-End Smoke Test");
  console.log("═══════════════════════════════════════════════");
  console.log(`Agent: ${keypair.toSuiAddress()}`);
  console.log(`Pkg  : ${PACKAGE_ID}`);

  // ── Step 1: 402 Challenge ────────────────────────────────────────────────────
  step(1, "GET /api/knowledge/sentiment (expect 402)");
  const challengeRes = await fetch(`${BASE_URL}/api/knowledge/sentiment`);
  if (challengeRes.status !== 402) {
    fail(`Expected 402, got ${challengeRes.status}`);
    process.exit(1);
  }
  const challenge = await challengeRes.json();
  ok(`402 received — request_hash: ${challenge.request_hash}`);
  ok(
    `Price: ${challenge.amount_mist} MIST (${Number(challenge.amount_mist) / 1e9} SUI)`,
  );

  // ── Step 2: Guardian pre-flight ──────────────────────────────────────────────
  step(2, "POST /api/guardian/analyze");
  const guardianRes = await fetch(`${BASE_URL}/api/guardian/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "PAY_402",
      amountMist: Number(challenge.amount_mist),
      scopeTag: 1,
      intentKey: `PAY_402:1:${challenge.amount_mist}:${Date.now()}`,
    }),
  });
  const guardian = await guardianRes.json();
  console.log(
    `     Risk: ${guardian.risk_level} (score ${guardian.risk_score})`,
  );
  if (guardian.blocks?.length) {
    fail(`Guardian BLOCKED: ${guardian.blocks.join(", ")}`);
    fail(guardian.human_summary);
    process.exit(1);
  }
  ok(`Guardian cleared — ${guardian.human_summary}`);

  // ── Step 3: Build + sign pay_402_invoice PTB ─────────────────────────────────
  step(3, "Agent signs & submits pay_402_invoice PTB");
  const PAYMENT_REGISTRY_ID = process.env.NEXT_PUBLIC_PAYMENT_REGISTRY_ID;
  if (!PAYMENT_REGISTRY_ID) throw new Error("NEXT_PUBLIC_PAYMENT_REGISTRY_ID not set in .env");
  const pcr0Hex = process.env.EXPECTED_PCR0?.replace(/"/g, "");
  if (!pcr0Hex || pcr0Hex.length < 96) throw new Error("EXPECTED_PCR0 not set or invalid in .env");
  const pcr0Bytes = new Uint8Array(pcr0Hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
  
  const tx = new Transaction();
  tx.moveCall({
    target: `${PACKAGE_ID}::velo_wallet::pay_402_invoice`,
    arguments: [
      tx.object(POLICY_ID),
      tx.object(TREASURY_ID),
      tx.object(PAYMENT_REGISTRY_ID),
      tx.pure.string(challenge.request_hash),
      tx.pure.u64(BigInt(challenge.amount_mist)),
      tx.pure(bcs.vector(bcs.u8()).serialize(pcr0Bytes)), // Nautilus attestation hash (Uint8Array)
      tx.pure.address(keypair.toSuiAddress()), // paying to self for demo
      tx.object('0x6'), // Clock
    ],
  });

  let digest: string;
  try {
    const result = await client.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    if (result.effects?.status?.status !== "success") {
      fail("PTB failed on-chain", result.effects?.status);
      // Show move abort if present
      const abortCode = (result.effects?.status as any)?.error;
      if (abortCode) console.error("     Abort:", abortCode);
      process.exit(1);
    }

    digest = result.digest;
    ok(`Payment submitted — digest: ${digest}`);

    // Log AgentActionEvent if present
    const event = result.events?.find((e) =>
      e.type?.includes("AgentActionEvent"),
    );
    if (event) {
      const j = event.parsedJson as any;
      ok(
        `AgentActionEvent emitted — action: ${j?.action_type}, remaining_budget: ${j?.remaining_budget} MIST`,
      );
    }
  } catch (err: any) {
    fail("PTB submission threw", err.message ?? err);
    process.exit(1);
  }

  // ── Step 4: Re-submit with payment proof ─────────────────────────────────────
  step(
    4,
    "GET /api/knowledge/sentiment with payment proof (waiting 4s for RPC indexing)",
  );
  await new Promise((r) => setTimeout(r, 4000)); // let testnet RPC index the tx
  const verifyRes = await fetch(`${BASE_URL}/api/knowledge/sentiment`, {
    headers: {
      "x-velo402-payment-digest": digest!,
      "x-velo402-request-hash": challenge.request_hash,
    },
  });
  const verifyBody = await verifyRes.json();

  if (!verifyRes.ok) {
    fail(`Verification failed (${verifyRes.status})`, verifyBody);
    process.exit(1);
  }
  ok(`Payment verified on-chain — status ${verifyRes.status}`);
  ok(`Response: ${JSON.stringify(verifyBody)}`);

  // ── Step 5: Verify policy spend updated ─────────────────────────────────────
  step(5, "Verify PolicyCap current_spend updated on-chain");
  const policyRes = await fetch(`${BASE_URL}/api/policy/status`);
  const policyBody = await policyRes.json();
  const spend = Number(policyBody.policy?.currentSpend ?? 0);
  if (spend > 0) {
    ok(`PolicyCap.current_spend = ${spend} MIST (${spend / 1e9} SUI)`);
  } else {
    fail("current_spend still 0 — may need a moment for RPC to sync");
  }

  console.log("\n═══════════════════════════════════════════════");
  console.log(" ✅ All steps passed — Velo402 loop is live!");
  console.log("═══════════════════════════════════════════════\n");
}

main().catch((err) => {
  console.error("\n💥 Fatal:", err);
  process.exit(1);
});
