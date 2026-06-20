/**
 * app/api/policy/status/route.ts
 * Returns the live PolicyCap + Treasury state for the dashboard.
 */
import { NextResponse } from "next/server";
import { fetchPolicyCap, fetchSwarmPolicyCaps, fetchTreasury } from "@/lib/policy-reader";
import { suiClient } from "@/lib/sui-client";

export async function GET() {
  try {
    const [policy, swarm, treasury, epoch] = await Promise.all([
      fetchPolicyCap(),
      fetchSwarmPolicyCaps(),
      fetchTreasury(),
      suiClient.getLatestSuiSystemState().then((s) => Number(s.epoch)),
    ]);

    const epochsRemaining = Math.max(0, policy.expirationEpoch - epoch);

    return NextResponse.json({
      ok: true,
      policy: {
        ...policy,
        maxSpend: policy.maxSpend.toString(),
        currentSpend: policy.currentSpend.toString(),
        remainingBudget: policy.remainingBudget.toString(),
      },
      policies: swarm.map(p => ({
        ...p,
        maxSpend: p.maxSpend.toString(),
        currentSpend: p.currentSpend.toString(),
        remainingBudget: p.remainingBudget.toString(),
      })),
      treasury: {
        ...treasury,
        balanceMist: treasury.balanceMist.toString(),
      },
      currentEpoch: epoch,
      epochsRemaining,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
