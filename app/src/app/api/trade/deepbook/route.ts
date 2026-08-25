/**
 * app/api/trade/deepbook/route.ts
 *
 * Executes a DeepBook trade on behalf of the agent (Spot / Margin / Predict).
 * Signs with the agent's keypair from AGENT_PRIVATE_KEY env var.
 *
 * POST body:
 *   { action: 'BUY'|'SELL', amountMist: number, scopeTag: 2|3|4,
 *     confirmationToken?: string }
 *
 * Returns: { ok, digest, effects }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  buildDeepbookSpotTx,
  buildDeepbookAdvancedTx,
} from "@/lib/ptb-builders";
import { suiClient } from "@/lib/sui-client";
import { getAgentKeypair } from "@/lib/agent-keypair";
import { SCOPE } from "@/lib/velo-constants";

// Per-scope pool IDs from live DeepBook testnet indexer
const DEEPBOOK_SPOT_POOL =
  process.env.NEXT_PUBLIC_DEEPBOOK_SPOT_POOL_ID ??
  "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5";
const DEEPBOOK_MARGIN_POOL =
  process.env.NEXT_PUBLIC_DEEPBOOK_MARGIN_POOL_ID ??
  "0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f";
const DEEPBOOK_PREDICT_POOL =
  process.env.NEXT_PUBLIC_DEEPBOOK_PREDICT_POOL_ID ??
  "0x8c1c1b186c4fddab1ebd53e0895a36c1d1b3b9a77cd34e607bef49a38af0150a";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action: "BUY" | "SELL";
      amountMist: number;
      scopeTag: 2 | 3 | 4;
      confirmationToken?: string;
      skipGuardian?: boolean;
    };

    const { action, amountMist, scopeTag, skipGuardian } = body;

    if (!amountMist || amountMist <= 0) {
      return NextResponse.json(
        { error: "amountMist must be positive." },
        { status: 400 },
      );
    }
    if (
      ![
        SCOPE.DEEPBOOK_SPOT,
        SCOPE.DEEPBOOK_MARGIN,
        SCOPE.DEEPBOOK_PREDICT,
      ].includes(scopeTag)
    ) {
      return NextResponse.json(
        { error: "scopeTag must be 2 (spot), 3 (margin), or 4 (predict)." },
        { status: 400 },
      );
    }

    // ── Guardian pre-flight (unless explicitly skipped by agent runner) ───────
    if (!skipGuardian) {
      const guardianRes = await fetch(
        `${req.nextUrl.origin}/api/guardian/analyze`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            amountMist,
            scopeTag,
            intentKey: `${action}:${scopeTag}:${amountMist}:${Date.now()}`,
          }),
        },
      );
      const guardian = await guardianRes.json();

      if (guardian.blocks?.length) {
        return NextResponse.json(
          {
            ok: false,
            blocked: true,
            risk_level: guardian.risk_level,
            blocks: guardian.blocks,
            human_summary: guardian.human_summary,
          },
          { status: 403 },
        );
      }
    }

    // ── Build PTB — route to correct per-scope pool ───────────────────────────
    const keypair = getAgentKeypair();
    let tx;

    if (scopeTag === SCOPE.DEEPBOOK_SPOT) {
      // SUI_DBUSDC — primary liquid spot pair
      tx = buildDeepbookSpotTx({
        amountMist: BigInt(amountMist),
        deepbookBalanceManager: DEEPBOOK_SPOT_POOL,
      });
    } else {
      // DEEP_SUI (margin) or WAL_SUI (predict)
      tx = buildDeepbookAdvancedTx({
        amountMist: BigInt(amountMist),
        scopeTag,
        deepbookMarginPoolId: DEEPBOOK_MARGIN_POOL,
        deepbookPredictPoolId: DEEPBOOK_PREDICT_POOL,
      });
    }

    // ── Sign & submit ─────────────────────────────────────────────────────────
    const raw = await suiClient.signAndExecuteTransaction({
      signer: keypair,
      transaction: tx,
      include: { effects: true, events: true },
    });
    const result = raw.$kind === "Transaction" ? raw.Transaction : raw.FailedTransaction;

    if (!result.status.success) {
      return NextResponse.json(
        {
          ok: false,
          digest: result.digest,
          error: "Transaction failed on-chain.",
          effects: result.effects,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      digest: result.digest,
      action,
      amount_mist: amountMist,
      scope_tag: scopeTag,
      events: result.events ?? [],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
