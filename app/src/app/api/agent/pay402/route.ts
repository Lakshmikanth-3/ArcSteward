/**
 * app/api/agent/pay402/route.ts
 *
 * POST /api/agent/pay402
 *
 * Builds, signs, and submits the pay_402_invoice PTB.
 * Called by the autonomous agent-runner when it needs to pay a 402 challenge.
 *
 * Body: { amountMist: string|number, nonce: string, recipient: string }
 *
 * Returns: { ok, digest, effects }
 *
 * Security:
 *   - Signed with AGENT_PRIVATE_KEY (server-side only, never in browser)
 *   - Nautilus PCR0 bytes taken from EXPECTED_PCR0 env (or live enclave)
 *   - PaymentRegistry and PolicyCap IDs taken from .env
 */
import { NextRequest, NextResponse } from "next/server";
import { buildPay402Tx } from "@/lib/ptb-builders";
import { suiClient } from "@/lib/sui-client";
import { getAgentKeypair } from "@/lib/agent-keypair";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      amountMist: string | number;
      nonce: string;
      recipient: string;
    };

    const { amountMist, nonce, recipient } = body;

    if (!amountMist || !nonce || !recipient) {
      return NextResponse.json(
        { error: "amountMist, nonce, and recipient are required." },
        { status: 400 }
      );
    }

    // Validate PCR0 is configured — required for attested 402 payments
    const pcr0Hex = (process.env.EXPECTED_PCR0 ?? "").replace(/"/g, "");
    if (!pcr0Hex || pcr0Hex.length < 96) {
      return NextResponse.json(
        {
          error:
            "EXPECTED_PCR0 is not set or is invalid in .env. " +
            "This must be the 48-byte SHA-384 hex of the Nautilus enclave image. " +
            "Run: `nitro-cli describe-enclaves | jq '.[0].Measurements.PCR0'` on your EC2 instance.",
        },
        { status: 503 }
      );
    }

    const pcr0Bytes = new Uint8Array(
      pcr0Hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
    );

    const tx = buildPay402Tx({
      amountMist: BigInt(amountMist),
      recipient,
      nonce,
      nautilusAttestationHash: pcr0Bytes,
    });

    const keypair = getAgentKeypair();

    const result = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      options: { showEffects: true, showEvents: true },
    });

    if (result.effects?.status?.status !== "success") {
      return NextResponse.json(
        {
          ok: false,
          digest: result.digest,
          error: "pay_402_invoice transaction failed on-chain.",
          effects: result.effects,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      digest: result.digest,
      amount_mist: String(amountMist),
      recipient,
      events: result.events ?? [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
