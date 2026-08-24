/**
 * app/api/rooster/offers/[offerId]/reconciliation/route.ts
 * GET — read-only reconciliation record: which RoosterCapability funded
 * which Rooster offer, at which deposit address, with which tx hash, in
 * which settlement state. No secrets in this record.
 */
import { NextRequest, NextResponse } from "next/server";
import { getRecordByOfferId } from "@/lib/rooster/ledger-store";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;
  const record = await getRecordByOfferId(offerId);
  if (!record) {
    return NextResponse.json(
      { ok: false, error: `No reconciliation record for offer ${offerId}.` },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true, record });
}
