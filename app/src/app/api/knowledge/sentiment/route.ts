/**
 * app/api/knowledge/sentiment/route.ts
 *
 * HTTP 402 gated Knowledge Agent endpoint.
 *
 * Flow:
 *   1. First request (no headers) → 402 challenge with request_hash nonce.
 *   2. Agent pays via pay_402_invoice PTB, gets a tx digest.
 *   3. Agent retries with x-velo402-payment-digest + x-velo402-request-hash.
 *   4. This route verifies the AgentActionEvent on-chain (no Supabase
 *      in the security path — the chain is the single source of truth).
 *   5. Returns Walrus blobId + Seal policy package so the agent can
 *      decrypt the dataset with @mysten/seal.
 */
import { NextRequest, NextResponse } from "next/server";
import { suiClient } from "@/lib/sui-client";

const KNOWLEDGE_PRICE_MIST = BigInt(
  process.env.KNOWLEDGE_PRICE_MIST ?? "50000000",
);
const PACKAGE_ID = process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID ?? "";
const SEAL_POLICY_PKG = process.env.NEXT_PUBLIC_VELO402_SEAL_POLICY_PKG ?? "";

// In production, blob IDs are registered on-chain or in a simple registry.
// This map is populated by running: npx tsx --env-file=.env scripts/encrypt-and-publish-dataset.ts
const BLOB_REGISTRY: Record<string, string> = {
  // Real Pyth SUI/USD oracle data blob ($0.7146, published 2026-06-18)
  // Encrypted via Seal, stored on Walrus, fetched from Pyth Hermes v2
  '2937619863294903a271d5200e204edb': '_SBjvQk91_1Q71Zgp5R_pt72rqE5iDjP5kGioBTRkiQ',
  // New Pyth SUI/USD oracle data ($0.7166, published 2026-06-19)
  '5ba6b465bfd14563ad26912cb7d2a9e8': 'VeoqzfgEVAYgolDB3Nan9jRuaEDj89uvT3U0Y1xDkLA',
  '715ad19620b2497aad16ad14cfd1facb': 'rY10S_BsvLJmi1b3U7Vz5rgP8ztBw-48UvaiNn6oGPc',
  '98057c34a3754348857108cad24074cb': 'fIxsTCPXAQta_GQcZWf3f6gnx5VIZaYDYZCEvHLh-24',
  'd7b2cd10ac4944a2b4605dc73cf7a416': '3Oay8QaMMlP3GcJY9wBbe--_m8mBsUWlxWcbzo6FCWw',
  'c15e952c8c674e63917c3bd832775ccf': 'jNf9ZVFAC5mAIlfR5YpUEtv2LVtPqelOZYlBqgeetQ0',
  '44237d02b58d4c3da950aabccccbc046': '0gxslZsXqo9-QJ9THgMj3F8IHy7JMH__o3zFRu8IIVo',
  '4cf483114f01493ca5c45ffce0b90bf1': 'DVJMnRsaHhLP5QpmxPfabKAV5KUOedF2hiY-aMa_PKM',
  // Newly generated Pyth SUI/USD oracle data
  '81925e20930b44d7aa3657011cb24a5f': 'x4NS-4GrZ_Ls-pGdxa5zgj9ubB1_TGffBajZnexNnhA',
};

export async function GET(req: NextRequest) {
  const digest = req.headers.get("x-velo402-payment-digest");
  const requestHash = req.headers.get("x-velo402-request-hash");

  // ── Step 1: No payment credentials → issue 402 challenge ─────────────────
  if (!digest || !requestHash) {
    // Pick a valid, available blob/hash pair from the registry
    const availableHashes = Object.keys(BLOB_REGISTRY);
    if (availableHashes.length === 0) {
      return NextResponse.json({ error: "No datasets available" }, { status: 503 });
    }
    // Issue the challenge for the most recently published real blob
    const nonce = availableHashes[availableHashes.length - 1];
    return NextResponse.json(
      {
        error: "Payment Required",
        amount_mist: KNOWLEDGE_PRICE_MIST.toString(),
        recipient: process.env.NEXT_PUBLIC_TREASURY_ID ?? "",
        request_hash: nonce,
        instruction:
          "Call velo402::velo_wallet::pay_402_invoice with this request_hash as " +
          "the nonce, then resubmit with x-velo402-payment-digest header.",
      },
      { status: 402 },
    );
  }

  try {
    let tx;
    let lastErr;
    // Retry loop with exponential backoff to handle RPC indexing delays
    for (let i = 0; i < 4; i++) {
      try {
        tx = await suiClient.waitForTransaction({
          digest,
          options: { showEvents: true },
          timeout: 3000, // 3 second timeout per attempt
        });
        break; // Success
      } catch (err) {
        lastErr = err;
        if (i < 3) {
          await new Promise((r) => setTimeout(r, 500 * Math.pow(2, i))); // Wait 500ms, 1s, 2s
        }
      }
    }

    if (!tx) {
      throw lastErr || new Error("Transaction could not be verified after retries.");
    }

    // action_type is emitted as vector<u8> in Move; the RPC may return it as
    // an array of byte numbers OR as a pre-decoded string depending on SDK version.
    const agentActionEvent = tx.events?.find((e) => {
      if (e.type !== `${PACKAGE_ID}::velo_wallet::AgentActionEvent`)
        return false;
      const raw = (e.parsedJson as any)?.action_type;
      // Decode byte array → string if needed
      const actionStr = Array.isArray(raw)
        ? String.fromCharCode(...raw)
        : String(raw ?? "");
      return actionStr === "402_DATA_PURCHASE";
    });

    if (!agentActionEvent) {
      return NextResponse.json(
        { error: "No matching AgentActionEvent found in transaction." },
        { status: 402 },
      );
    }

    const paid = BigInt((agentActionEvent.parsedJson as any)?.amount ?? 0);
    if (paid < KNOWLEDGE_PRICE_MIST) {
      return NextResponse.json(
        {
          error: `Insufficient payment: expected ${KNOWLEDGE_PRICE_MIST} MIST, got ${paid} MIST.`,
        },
        { status: 402 },
      );
    }

    // ── Step 3: Return real Walrus blob reference + Seal policy for decryption ────
    const blobId = BLOB_REGISTRY[requestHash] ?? null;

    return NextResponse.json({
      ok: true,
      digest,
      request_hash: requestHash,
      blob_id: blobId,
      seal_policy_pkg: SEAL_POLICY_PKG,
      message: blobId
        ? "Payment verified. Fetch blob from Walrus and decrypt with Seal."
        : "Payment verified. No blob registered for this request_hash yet — " +
          "run scripts/encrypt-and-publish-dataset.ts to publish data.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "RPC verification failed.", details: msg },
      { status: 500 },
    );
  }
}
