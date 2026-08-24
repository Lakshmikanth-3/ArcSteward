/**
 * app/api/rooster/capabilities/route.ts
 *
 * POST — Operator-only. Issues a RoosterCapability for an agent, the
 * off-chain stand-in for velo_wallet::mint_policy on this rail. NOT
 * agent-facing/self-service: no agent-side code anywhere in this repo calls
 * this route. Guarded by a shared-secret header (ROOSTER_OPERATOR_KEY) and a
 * hard per-capability ceiling (ROOSTER_MAX_CAPABILITY_CENTS) — both fail
 * closed if unset.
 */
import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { issueCapability } from "@/lib/rooster/capability-store";
import { getMaxCapabilityCents, getRoosterOperatorKey } from "@/lib/rooster/config";
import { CapabilityDeniedError, type Currency } from "@/lib/rooster/types";

function isAuthorized(req: NextRequest): boolean {
  const provided = req.headers.get("x-operator-key");
  if (!provided) return false;
  const expected = getRoosterOperatorKey();
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { ok: false, error: "Missing or invalid x-operator-key header." },
        { status: 401 },
      );
    }

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
    const ceiling = getMaxCapabilityCents();
    if (body.maxAmountCents > ceiling) {
      return NextResponse.json(
        {
          ok: false,
          error: `maxAmountCents ${body.maxAmountCents} exceeds the configured ceiling ${ceiling}c (ROOSTER_MAX_CAPABILITY_CENTS).`,
        },
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
