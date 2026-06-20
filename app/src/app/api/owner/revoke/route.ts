/**
 * app/api/owner/revoke/route.ts
 *
 * Permanently burns the agent's PolicyCap — the kill switch.
 * Signs and executes the revoke_policy PTB using the backend agent key.
 */
import { NextRequest, NextResponse } from "next/server";
import { buildRevokePolicyTx } from "@/lib/ptb-builders";
import { suiClient } from "@/lib/sui-client";
import { getAgentKeypair } from "@/lib/agent-keypair";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      policyCapId: string;
    };

    const { policyCapId } = body;

    if (!policyCapId) {
      return NextResponse.json(
        { error: "policyCapId is required." },
        { status: 400 },
      );
    }

    const ownerCapId = process.env.OWNER_CAP_ID;
    if (!ownerCapId) {
      return NextResponse.json(
        { error: "OWNER_CAP_ID is not set in .env" },
        { status: 500 },
      );
    }

    const tx = buildRevokePolicyTx({ ownerCapId, policyCapId });
    const kp = getAgentKeypair();
    const result = await suiClient.signAndExecuteTransaction({
      transaction: tx,
      signer: kp,
    });

    return NextResponse.json({
      ok: true,
      digest: result.digest,
      revokedPolicyCapId: policyCapId,
      warning:
        "PolicyCap permanently deleted. The agent can no longer execute any transactions.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
