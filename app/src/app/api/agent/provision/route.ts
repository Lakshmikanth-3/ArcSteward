/**
 * app/api/agent/provision/route.ts
 *
 * Returns an unsigned, serialized PTB for minting a PolicyCap.
 * The frontend passes this to the human's connected wallet for signing.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildMintPolicyTx } from "@/lib/ptb-builders";
import { suiClient } from "@/lib/sui-client";
import { getAgentKeypair } from "@/lib/agent-keypair";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      ownerCapId: string;
      maxSpendSui: number;
      expirationEpoch: number;
      allowedScopes: number[];
      attestedComputeRequired: boolean;
      agentAddress: string;
    };

    const {
      ownerCapId,
      maxSpendSui,
      expirationEpoch,
      allowedScopes,
      attestedComputeRequired,
      agentAddress,
    } = body;

    if (!ownerCapId || !agentAddress) {
      return NextResponse.json(
        { error: "ownerCapId and agentAddress are required." },
        { status: 400 },
      );
    }

    const maxSpendMist = BigInt(Math.round(maxSpendSui * 1e9));

    const expectedPcr0 = process.env.EXPECTED_PCR0;
    if (!expectedPcr0) {
      return NextResponse.json(
        { error: "EXPECTED_PCR0 is not set in .env" },
        { status: 500 },
      );
    }

    const tx = buildMintPolicyTx({
      ownerCapId,
      maxSpendMist,
      expirationEpoch,
      allowedScopes,
      attestedComputeRequired,
      expectedPcr0,
      agentAddress,
    });

    // Sign and execute the transaction directly using the backend key
    const kp = getAgentKeypair();
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: kp,
    });

    return NextResponse.json({
      ok: true,
      digest: result.digest,
      summary: {
        maxSpendSui,
        maxSpendMist: maxSpendMist.toString(),
        expirationEpoch,
        allowedScopes,
        attestedComputeRequired,
        agentAddress,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
