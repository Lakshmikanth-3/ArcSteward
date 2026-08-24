/**
 * app/api/rooster/offers/[offerId]/fund/route.ts
 *
 * The single capability-gated, idempotent money-movement entry point for
 * this integration. Order of operations:
 *
 *   1. Re-fetch LIVE offer status from Rooster — never trust a client-
 *      supplied funding amount or deposit address.
 *   2. Require the offer to actually be awaiting funding.
 *   3. authorizeRoosterSpend() — the capability check (destination, currency,
 *      amount ceiling against the real funding amount, offer match, one-time/
 *      already-funded, expiry).
 *   4. Idempotency: a SUBMITTED or CONFIRMED record for this (agent, offer)
 *      short-circuits immediately — this offer can never be funded twice.
 *      A PENDING or FAILED record (no on-chain effect yet) is safe to retry.
 *   5. Only then does the real Base settlement adapter run.
 */
import { NextRequest, NextResponse } from "next/server";
import { RoosterClient } from "@/lib/rooster/rooster-client";
import { authorizeRoosterSpend } from "@/lib/rooster/capability";
import {
  computeIdempotencyKey,
  createPendingRecord,
  getRecord,
  updateRecordState,
} from "@/lib/rooster/ledger-store";
import { getSettlementNetwork } from "@/lib/rooster/config";
import { BaseSepoliaSettlementAdapter } from "@/lib/rooster/settlement-adapter";
import {
  CapabilityDeniedError,
  RoosterApiError,
  SettlementNotImplementedError,
} from "@/lib/rooster/types";
import { roosterLogger } from "@/lib/rooster/logger";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;
  try {
    const body = (await req.json()) as { agentId?: string };
    const agentId = body.agentId;
    if (!agentId) {
      return NextResponse.json({ ok: false, error: "agentId is required." }, { status: 400 });
    }

    // 1. Live status — the deposit address/amount always comes from Rooster, never the client.
    const client = new RoosterClient();
    const status = await client.getOfferStatus(offerId);

    // 2. Must actually be awaiting funding with real escrow details.
    if (!status.funding?.depositAddress || !status.funding.amountCents) {
      return NextResponse.json(
        { ok: false, error: `Offer ${offerId} is not awaiting funding (state: ${status.state}).` },
        { status: 409 },
      );
    }

    // 3. Capability check — authorized against the REAL funding amount (price + marketplace fee).
    const { capability } = await authorizeRoosterSpend({
      agentId,
      offerId,
      destination: "rooster",
      currency: status.funding.currency,
      amountCents: status.funding.amountCents,
    });

    // 4. Idempotency.
    const idempotencyKey = computeIdempotencyKey(agentId, offerId, "fund");
    const existing = await getRecord(idempotencyKey);
    if (existing && (existing.state === "SUBMITTED" || existing.state === "CONFIRMED")) {
      roosterLogger.info("Rooster funding replay — already submitted, returning cached outcome", {
        offerId,
        agentId,
        state: existing.state,
        result: "idempotent_replay",
      });
      return NextResponse.json({ ok: true, record: existing, replay: true });
    }

    const network = getSettlementNetwork();
    if (!existing) {
      await createPendingRecord({
        idempotencyKey,
        agentId,
        offerId,
        capability,
        network,
        amountCents: status.funding.amountCents,
        depositAddress: status.funding.depositAddress,
      });
    }

    // 5. Real settlement — reachable only for a PENDING/FAILED record (never re-run after success).
    const adapter = new BaseSepoliaSettlementAdapter(network);
    try {
      const fundResult = await adapter.fund({
        offerId,
        depositAddress: status.funding.depositAddress as `0x${string}`,
        amountCents: status.funding.amountCents,
      });

      const updated = await updateRecordState(idempotencyKey, "SUBMITTED", {
        txHash: fundResult.txHash,
      });

      roosterLogger.info("Rooster offer funded on Base", {
        offerId,
        agentId,
        network,
        txHash: fundResult.txHash,
        state: updated.state,
        result: "submitted",
      });

      return NextResponse.json({ ok: true, record: updated, replay: false });
    } catch (fundErr) {
      const message = fundErr instanceof Error ? fundErr.message : String(fundErr);
      await updateRecordState(idempotencyKey, "FAILED", { error: message });
      throw fundErr;
    }
  } catch (err: unknown) {
    if (err instanceof CapabilityDeniedError) {
      return NextResponse.json(
        { ok: false, error: err.message, reason: err.reason },
        { status: 403 },
      );
    }
    if (err instanceof SettlementNotImplementedError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 501 });
    }
    if (err instanceof RoosterApiError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status ?? 502 });
    }
    const msg = err instanceof Error ? err.message : String(err);
    roosterLogger.error("Rooster funding failed", { offerId, result: msg });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
