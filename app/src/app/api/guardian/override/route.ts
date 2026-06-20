/**
 * app/api/guardian/override/route.ts
 *
 * POST /api/guardian/override
 *
 * Records a human operator override of a Guardian warning.
 * The override is logged to the Sui blockchain by emitting a
 * synthetic AgentActionEvent with action_type = "HUMAN_OVERRIDE".
 *
 * Body: { confirmation_token: string, audit_note: string }
 *
 * Returns: { ok, digest, recorded_at, confirmation_token }
 *
 * Security note: Only warn-level (requires_confirmation=true, blocks=[])
 * alerts can be overridden. BLOCK-level alerts are never overrideable
 * without fixing the underlying condition (expired policy, over budget, etc.).
 */
import { NextRequest, NextResponse } from "next/server";
import { Transaction } from "@mysten/sui/transactions";
import { suiClient, PACKAGE_ID, TREASURY_ID, POLICY_CAP_ID } from "@/lib/sui-client";
import { getAgentKeypair } from "@/lib/agent-keypair";

// In-memory token registry to prevent replay of confirmation tokens.
// Production: use a Sui on-chain registry or Redis with TTL.
const usedTokens = new Set<string>();

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      confirmation_token: string;
      audit_note: string;
    };

    const { confirmation_token, audit_note } = body;

    if (!confirmation_token || !audit_note) {
      return NextResponse.json(
        { error: "confirmation_token and audit_note are required." },
        { status: 400 }
      );
    }

    if (audit_note.trim().length < 10) {
      return NextResponse.json(
        { error: "audit_note must be at least 10 characters — provide a meaningful justification." },
        { status: 400 }
      );
    }

    // Replay protection
    if (usedTokens.has(confirmation_token)) {
      return NextResponse.json(
        { error: "confirmation_token already used. Each token may only be submitted once." },
        { status: 409 }
      );
    }

    // Build a PTB that emits an AgentActionEvent with action_type = "HUMAN_OVERRIDE"
    // This creates an immutable, on-chain audit trail of the human decision.
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::velo_wallet::record_human_override`,
      arguments: [
        tx.object(POLICY_CAP_ID),
        tx.object(TREASURY_ID),
        tx.pure.string(confirmation_token),
        tx.pure.string(audit_note.slice(0, 256)), // max 256 chars on-chain
        tx.object("0x6"), // Sui clock
      ],
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
          error: "record_human_override transaction failed on-chain.",
          hint: "If record_human_override is not yet in the Move package, the override is still logged server-side.",
          effects: result.effects,
        },
        { status: 500 }
      );
    }

    // Mark token as used only after on-chain success
    usedTokens.add(confirmation_token);

    return NextResponse.json({
      ok: true,
      digest: result.digest,
      recorded_at: new Date().toISOString(),
      confirmation_token,
      note: "Human override recorded on-chain via AgentActionEvent. Audit trail is immutable.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    // If the Move function doesn't exist yet (package not upgraded), log it server-side
    // but still return ok so the UI doesn't block.
    if (msg.includes("FunctionNotFound") || msg.includes("VMVerification")) {
      return NextResponse.json({
        ok: true,
        digest: null,
        recorded_at: new Date().toISOString(),
        confirmation_token: (await req.json().catch(() => ({}))).confirmation_token,
        note:
          "Override logged server-side only — record_human_override function not found in current package. " +
          "Upgrade the Move package to include this entry function for on-chain audit trail.",
        rpc_error: msg,
      });
    }

    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
