/**
 * app/api/treasury/yield/sweep/route.ts
 *
 * POST /api/treasury/yield/sweep
 *
 * Executes the sweep_idle_to_yield Move call to mark idle treasury
 * funds for yield via the Scallop protocol.
 * Signs with the agent keypair (PolicyCap holder).
 *
 * Body: { idleAmountMist?: number }  — defaults to (balance - 0.01 SUI reserve)
 */
import { NextRequest, NextResponse } from "next/server";
import { Transaction } from "@mysten/sui/transactions";
import { suiClient, PACKAGE_ID, TREASURY_ID, POLICY_CAP_ID } from "@/lib/sui-client";
import { getAgentKeypair } from "@/lib/agent-keypair";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      idleAmountMist?: number;
    };

    // Fetch current treasury balance
    const treasuryObj = await suiClient.getObject({
      id: TREASURY_ID,
      options: { showContent: true },
    });
    const content = treasuryObj.data?.content as any;
    const balanceMist = BigInt(content?.fields?.balance ?? 0);

    const RESERVE_MIST = 10_000_000n; // 0.01 SUI kept for gas
    const sweepMist = body.idleAmountMist
      ? BigInt(body.idleAmountMist)
      : balanceMist > RESERVE_MIST
      ? balanceMist - RESERVE_MIST
      : 0n;

    if (sweepMist <= 0n) {
      return NextResponse.json(
        {
          ok: false,
          error: `Insufficient idle balance. Treasury has ${balanceMist} MIST, need > ${RESERVE_MIST} MIST to sweep.`,
          balance_mist: balanceMist.toString(),
        },
        { status: 400 }
      );
    }

    // Build the sweep PTB
    const tx = new Transaction();
    tx.moveCall({
      target: `${PACKAGE_ID}::velo_wallet::sweep_idle_to_yield`,
      arguments: [
        tx.object(POLICY_CAP_ID),
        tx.object(TREASURY_ID),
        tx.pure.u64(sweepMist),
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
          error: "Sweep transaction failed on-chain.",
          effects: result.effects,
        },
        { status: 500 }
      );
    }

    const sweepEvent = result.events?.find((e) =>
      e.type?.includes("AgentActionEvent")
    );

    return NextResponse.json({
      ok: true,
      digest: result.digest,
      sweep_mist: sweepMist.toString(),
      sweep_sui: (Number(sweepMist) / 1e9).toFixed(9),
      event: sweepEvent?.parsedJson ?? null,
      note: "Idle treasury funds marked for Scallop yield sweep.",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
