/**
 * app/api/rooster/capabilities/route.ts
 *
 * POST — Operator-only. Issues a RoosterCapability for an agent, the
 * off-chain stand-in for velo_wallet::mint_policy on this rail. NOT
 * agent-facing/self-service: no agent-side code anywhere in this repo calls
 * this route. In a real deployment this must sit behind operator
 * authentication (session/admin-key middleware) before handling any
 * non-local traffic.
 */
import { NextRequest, NextResponse } from "next/server";
import { issueCapability } from "@/lib/rooster/capability-store";
import { CapabilityDeniedError, type Currency } from "@/lib/rooster/types";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      agentId?: string;
      currency?: Currency;
      maxAmountCents?: number;
      offerId?: string;
      oneTime?: boolean;
      ttlMinutes?: number;
    };

    if (!body.agentId) {
      return NextResponse.json({ ok: false, error: "agentId is required." }, { status: 400 });
    }
    if (!body.maxAmountCents || body.maxAmountCents <= 0) {
      return NextResponse.json(
        { ok: false, error: "maxAmountCents must be positive." },
        { status: 400 },
      );
    }

    const capability = await issueCapability({
      agentId: body.agentId,
      currency: body.currency ?? "USDC",
      maxAmountCents: body.maxAmountCents,
      offerId: body.offerId,
      oneTime: body.oneTime ?? true,
      ttlMinutes: body.ttlMinutes ?? 60,
    });

    return NextResponse.json({ ok: true, capability });
  } catch (err: unknown) {
    if (err instanceof CapabilityDeniedError) {
      return NextResponse.json(
        { ok: false, error: err.message, reason: err.reason },
        { status: 400 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
