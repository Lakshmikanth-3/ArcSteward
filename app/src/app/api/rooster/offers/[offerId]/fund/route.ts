/**
 * app/api/rooster/offers/[offerId]/fund/route.ts
 *
 * The single capability-gated, idempotent money-movement entry point for
 * this integration. Order of operations:
 *
 *   1. Re-fetch LIVE offer status from Rooster — never trust a client-
 *      supplied funding amount or deposit address.
 *   2. Require the offer to actually be awaiting funding.
 *   3. Idempotency: a SUBMITTED or CONFIRMED record for this (agent, offer)
 *      short-circuits immediately — this offer can never be funded twice.
 *      Checked BEFORE the capability check on purpose, so a normal retry
 *      replays the cached outcome instead of being denied by capability.ts's
 *      own already-funded guard. A PENDING or FAILED record (no on-chain
 *      effect yet) is safe to retry.
 *   4. authorizeRoosterSpend() — the capability check (destination, currency,
 *      amount ceiling against the real funding amount, offer match, one-time/
 *      already-funded as defense-in-depth, expiry).
 *   5. Only then does the real Base settlement adapter run — and this offer
 *      is never called CONFIRMED off the back of a broadcast alone; we wait
 *      for a real on-chain receipt first (step 6).
 *   6. Confirmation: waitForConfirmation() against the actual chain. A
 *      broadcast success is not settlement — only a confirmed receipt is.
 *
 * handleFundRequest() holds all of the above as a plain, injectable-deps
 * function (mirrors RoosterClient's own constructor-injection pattern) so
 * it's unit-testable without a real network/chain call. POST is a thin
 * wrapper translating its result (or a thrown typed error) into a
 * NextResponse — the error-mapping here is unchanged from before this
 * function was extracted.
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
import { createSettlementAdapter, type SettlementAdapter } from "@/lib/rooster/settlement-adapter";
import {
  CapabilityDeniedError,
  RoosterApiError,
  SettlementNotImplementedError,
  type ReconciliationRecord,
} from "@/lib/rooster/types";
import { roosterLogger } from "@/lib/rooster/logger";

export interface HandleFundRequestDeps {
  client?: RoosterClient;
  adapter?: SettlementAdapter;
}

export interface FundResponseBody {
  ok: boolean;
  record?: ReconciliationRecord;
  replay?: boolean;
  error?: string;
  reason?: string;
}

export interface FundRouteResult {
  status: number;
  body: FundResponseBody;
}

export async function handleFundRequest(
  offerId: string,
  body: { agentId?: string },
  deps: HandleFundRequestDeps = {},
): Promise<FundRouteResult> {
  const agentId = body.agentId;
  if (!agentId) {
    return { status: 400, body: { ok: false, error: "agentId is required." } };
  }

  // 1. Live status — the deposit address/amount always comes from Rooster, never the client.
  const client = deps.client ?? new RoosterClient();
  const status = await client.getOfferStatus(offerId);

  // 2. Must actually be awaiting funding with real escrow details.
  if (!status.funding?.depositAddress || !status.funding.amountCents) {
    return {
      status: 409,
      body: { ok: false, error: `Offer ${offerId} is not awaiting funding (state: ${status.state}).` },
    };
  }

  // 3. Idempotency — checked BEFORE the capability check on purpose. A retry
  // of an already-SUBMITTED/CONFIRMED funding attempt must replay the cached
  // outcome, not get denied: capability.ts's own one-time-capability guard
  // also rejects an already-funded offer (ALREADY_FUNDED), which would throw
  // instead of returning this 200 replay if it ran first — that guard stays
  // in place as defense-in-depth for the race case, but this check is what
  // makes a normal retry succeed instead of erroring.
  const idempotencyKey = computeIdempotencyKey(agentId, offerId, "fund");
  const existing = await getRecord(idempotencyKey);
  if (existing && (existing.state === "SUBMITTED" || existing.state === "CONFIRMED")) {
    roosterLogger.info("Rooster funding replay — already submitted, returning cached outcome", {
      offerId,
      agentId,
      state: existing.state,
      result: "idempotent_replay",
    });
    return { status: 200, body: { ok: true, record: existing, replay: true } };
  }

  // 4. Capability check — authorized against the REAL funding amount (price + marketplace fee).
  const { capability } = await authorizeRoosterSpend({
    agentId,
    offerId,
    destination: "rooster",
    currency: status.funding.currency,
    amountCents: status.funding.amountCents,
  });

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
  const adapter = deps.adapter ?? createSettlementAdapter(network);
  let fundResult: Awaited<ReturnType<SettlementAdapter["fund"]>>;
  try {
    fundResult = await adapter.fund({
      offerId,
      depositAddress: status.funding.depositAddress as `0x${string}`,
      amountCents: status.funding.amountCents,
      tokenContract: status.funding.tokenContract,
      tokenDecimals: status.funding.tokenDecimals,
    });
  } catch (fundErr) {
    // Pre-broadcast failure — no txHash was ever obtained, this is a
    // distinct case from a confirmation failure below.
    const message = fundErr instanceof Error ? fundErr.message : String(fundErr);
    await updateRecordState(idempotencyKey, "FAILED", { error: message });
    throw fundErr;
  }

  await updateRecordState(idempotencyKey, "SUBMITTED", { txHash: fundResult.txHash });
  roosterLogger.info("Rooster offer funded on Base — awaiting confirmation", {
    offerId,
    agentId,
    network,
    txHash: fundResult.txHash,
    result: "submitted",
  });

  // 6. Never call an offer paid because the RPC accepted the broadcast —
  // only a real on-chain receipt counts. A failure here must NOT reuse the
  // pre-broadcast FAILED path above: the tx already has a hash and was
  // already recorded SUBMITTED, so it needs its own distinct message rather
  // than being stomped by the earlier catch's generic one.
  const confirmation = await adapter.waitForConfirmation(fundResult.txHash);
  if (confirmation.status !== "confirmed") {
    const updated = await updateRecordState(idempotencyKey, "FAILED", {
      txHash: fundResult.txHash,
      error: `Chain reported the funding transaction as failed (block ${confirmation.blockNumber}).`,
    });
    roosterLogger.error("Rooster funding transaction failed on-chain", {
      offerId,
      agentId,
      network,
      txHash: fundResult.txHash,
      result: "chain_failed",
    });
    return {
      status: 502,
      body: {
        ok: false,
        error: `Funding transaction ${fundResult.txHash} failed on-chain.`,
        record: updated,
      },
    };
  }

  const confirmed = await updateRecordState(idempotencyKey, "CONFIRMED", {
    txHash: fundResult.txHash,
  });
  roosterLogger.info("Rooster offer funding confirmed on-chain", {
    offerId,
    agentId,
    network,
    txHash: fundResult.txHash,
    result: "confirmed",
  });

  return { status: 200, body: { ok: true, record: confirmed, replay: false } };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ offerId: string }> },
) {
  const { offerId } = await params;
  try {
    const body = (await req.json()) as { agentId?: string };
    const result = await handleFundRequest(offerId, body);
    return NextResponse.json(result.body, { status: result.status });
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
