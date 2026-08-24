/**
 * app/api/rooster/creators/route.ts
 * GET — proxies Rooster's public creator directory (no auth required upstream).
 */
import { NextResponse } from "next/server";
import { RoosterClient } from "@/lib/rooster/rooster-client";
import { RoosterApiError } from "@/lib/rooster/types";

export async function GET() {
  try {
    const client = new RoosterClient();
    const creators = await client.listCreators();
    return NextResponse.json({ ok: true, creators });
  } catch (err: unknown) {
    if (err instanceof RoosterApiError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status ?? 502 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
