/**
 * app/api/rooster/offers/route.ts
 * POST — validates and submits an offer to Rooster. No money moves here
 * (submission is free, screening + benchmark verdict only) so no capability
 * check is required — that happens at /fund.
 */
import { NextRequest, NextResponse } from "next/server";
import { RoosterClient } from "@/lib/rooster/rooster-client";
import { validateOfferInput } from "@/lib/rooster/offer-validation";
import { RoosterApiError, RoosterValidationError, type OfferInput } from "@/lib/rooster/types";
import { roosterLogger } from "@/lib/rooster/logger";
import { listRecords } from "@/lib/rooster/ledger-store";

/**
 * GET — lists every offer this app has attempted to fund, from the local
 * reconciliation ledger (Rooster has no "list my offers" endpoint). Each
 * record's live lifecycle/state is fetched on demand per-offer via
 * /api/rooster/offers/[offerId]/status, not eagerly here.
 */
export async function GET() {
  const records = await listRecords();
  return NextResponse.json({ ok: true, records });
}

export async function POST(req: NextRequest) {
  try {
    const input = (await req.json()) as OfferInput;
    validateOfferInput(input);

    const client = new RoosterClient();
    const offer = await client.submitOffer(input);

    roosterLogger.info("Rooster offer submitted", {
      offerId: offer.offerId,
      testMode: input.testMode,
      result: "submitted",
    });

    return NextResponse.json({ ok: true, offerId: offer.offerId, raw: offer.raw });
  } catch (err: unknown) {
    if (err instanceof RoosterValidationError) {
      return NextResponse.json(
        { ok: false, error: err.message, issues: err.issues },
        { status: 400 },
      );
    }
    if (err instanceof RoosterApiError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status ?? 502 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
