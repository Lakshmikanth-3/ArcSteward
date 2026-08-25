/**
 * app/api/rooster/offers/[offerId]/status/route.ts
 * GET — proxies a single offer-status check. For a blocking wait use
 * lib/rooster/offer-status-poller.ts's waitForOfferStatus() from a script
 * or server-side caller instead of polling this route in a tight loop.
 */
import { NextRequest, NextResponse } from "next/server";
import { RoosterClient } from "@/lib/rooster/rooster-client";
import { RoosterApiError } from "@/lib/rooster/types";
import { reconcileFromStatus } from "@/lib/rooster/ledger-store";
import { roosterLogger } from "@/lib/rooster/logger";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;
  try {
    const client = new RoosterClient();
    const status = await client.getOfferStatus(offerId);

    // Best-effort: opportunistically merge Rooster's own lifecycle/release/
    // refund fields into the matching ledger record, if one exists. Never
    // lets a reconciliation-write failure break the status response itself.
    try {
      await reconcileFromStatus(offerId, status);
    } catch (reconcileErr) {
      const msg = reconcileErr instanceof Error ? reconcileErr.message : String(reconcileErr);
      roosterLogger.warn("Ledger reconciliation from live status failed — status still returned", {
        offerId,
        result: msg,
      });
    }

    return NextResponse.json({ ok: true, status });
  } catch (err: unknown) {
    if (err instanceof RoosterApiError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status ?? 502 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
