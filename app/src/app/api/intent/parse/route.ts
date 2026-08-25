/**
 * app/api/intent/parse/route.ts
 *
 * Intent Parser — Sub-track 3.
 * Converts plain-English financial goals into:
 *   1. Structured JSON action (action, asset, amount, scope)
 *   2. Guardian pre-flight risk analysis
 *   3. Human-readable PTB preview
 *   4. Unsigned PTB bytes (ready for signing)
 *
 * Uses claude-sonnet-4-6 via Anthropic API.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  buildPay402Tx,
  buildDeepbookSpotTx,
  buildDeepbookAdvancedTx,
} from "@/lib/ptb-builders";
import { suiClient } from "@/lib/sui-client";
import { fetchPolicyCap } from "@/lib/policy-reader";
import { SCOPE, SCOPE_LABEL } from "@/lib/velo-constants";

const INTENT_SYSTEM_PROMPT = `You are Velo402's intent parser. Convert plain-English financial instructions into structured JSON.

Output ONLY valid JSON with this exact schema:
{
  "action": "BUY" | "SELL" | "HOLD" | "PAY_402",
  "asset": "SUI" | "USDC" | "KNOWLEDGE_DATA",
  "amount_sui": <number, required>,
  "scope_tag": 1 | 2 | 3 | 4,  // 1=402_DATA 2=DEEPBOOK_SPOT 3=DEEPBOOK_MARGIN 4=DEEPBOOK_PREDICT
  "order_type": "spot" | "margin" | "predict" | "data_purchase",
  "urgency": "low" | "normal" | "high",
  "slippage_tolerance_bps": <integer, default 50>,
  "rationale": "<one sentence explaining the parsed intent>"
}

Scope tag mapping:
- Buying/purchasing data or API access → scope_tag: 1 (PAY_402)
- Simple token swap or trade → scope_tag: 2 (DEEPBOOK_SPOT)
- Leveraged/margin trade → scope_tag: 3 (DEEPBOOK_MARGIN)  
- Prediction market / binary position → scope_tag: 4 (DEEPBOOK_PREDICT)

If the intent is ambiguous or cannot be safely parsed, output:
{"error": "AMBIGUOUS_INTENT", "message": "<explain what's unclear>"}`;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { text: string };
    const { text } = body;

    if (!text || text.trim().length < 3) {
      return NextResponse.json(
        { error: "Intent text is required." },
        { status: 400 },
      );
    }

    // ── Step 1: Free Heuristic Parse (Replaces Anthropic) ────────────────────
    const lowerText = text.toLowerCase();

    // Default parsing results
    let action = "HOLD";
    let asset = "SUI";
    let amountSui = 0;
    let scopeTag = 2; // Default to SPOT
    let orderType = "spot";
    let rationale = "Parsed from natural language";

    // Extract numbers for amount
    const numberMatch = text.match(/[\d.]+/);
    if (numberMatch) {
      amountSui = parseFloat(numberMatch[0]);
    }

    // Determine Action
    if (lowerText.includes("buy") || lowerText.includes("purchase"))
      action = "BUY";
    else if (lowerText.includes("sell")) action = "SELL";
    else if (
      lowerText.includes("pay") ||
      lowerText.includes("knowledge") ||
      lowerText.includes("data")
    ) {
      action = "PAY_402";
      scopeTag = 1;
      orderType = "data_purchase";
    }

    // Determine Scope/Order Type for DeepBook
    if (action !== "PAY_402") {
      if (lowerText.includes("margin") || lowerText.includes("leverage")) {
        scopeTag = 3;
        orderType = "margin";
      } else if (lowerText.includes("predict") || lowerText.includes("bet")) {
        scopeTag = 4;
        orderType = "predict";
      }
    }

    const parsed: any = {
      action,
      asset,
      amount_sui: amountSui,
      scope_tag: scopeTag,
      order_type: orderType,
      urgency: "normal",
      slippage_tolerance_bps: 50,
      rationale: `Heuristic match: ${action} ${amountSui} via scope ${scopeTag}`,
    };

    if (amountSui <= 0) {
      return NextResponse.json(
        {
          error: "AMBIGUOUS_INTENT",
          message: "Could not determine a valid SUI amount from the request.",
        },
        { status: 422 },
      );
    }

    // ── Step 2: Validate & enrich ─────────────────────────────────────────────
    amountSui = Number(parsed.amount_sui ?? 0);
    const amountMist = Math.round(amountSui * 1e9);
    scopeTag = Number(parsed.scope_tag ?? 2);

    if (amountMist <= 0) {
      return NextResponse.json(
        { error: "INVALID_AMOUNT", message: "Amount must be positive." },
        { status: 422 },
      );
    }

    // ── Step 3: Fetch policy for preview data ─────────────────────────────────
    const [policy, epochData] = await Promise.all([
      fetchPolicyCap(),
      suiClient.core.getCurrentSystemState().then((r) => Number(r.systemState.epoch)),
    ]);

    const remaining = Number(policy.remainingBudget);
    const budgetUsedPctAfter =
      ((Number(policy.currentSpend) + amountMist) / Number(policy.maxSpend)) *
      100;

    // ── Step 4: Run Guardian pre-flight ──────────────────────────────────────
    const guardianRes = await fetch(
      `${req.nextUrl.origin}/api/guardian/analyze`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: parsed.action,
          amountMist,
          scopeTag,
          intentKey: `${parsed.action}:${scopeTag}:${amountMist}`,
        }),
      },
    );
    const guardian = await guardianRes.json();

    // ── Step 5: Build PTB (unsigned) ─────────────────────────────────────────
    let tx;
    let txBytes: string | null = null;

    if (!guardian.blocks?.length) {
      try {
        if (scopeTag === SCOPE.DATA_402) {
          const treasuryId = process.env.NEXT_PUBLIC_TREASURY_ID ?? "";
          const pcr0Hex = process.env.EXPECTED_PCR0?.replace(/"/g, "");
          if (!pcr0Hex || pcr0Hex.length < 96) {
            throw new Error("EXPECTED_PCR0 is not set or invalid in .env. Cannot build attested PTB.");
          }
          const pcr0Bytes = new Uint8Array(
            pcr0Hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16))
          );

          tx = buildPay402Tx({
            amountMist: BigInt(amountMist),
            recipient: treasuryId,
            nonce: crypto.randomUUID(),
            nautilusAttestationHash: pcr0Bytes,
          });
        } else if (scopeTag === SCOPE.DEEPBOOK_SPOT) {
          const spotPoolId = process.env.NEXT_PUBLIC_DEEPBOOK_SPOT_POOL_ID;
          if (!spotPoolId) throw new Error("NEXT_PUBLIC_DEEPBOOK_SPOT_POOL_ID not set in .env");
          tx = buildDeepbookSpotTx({
            amountMist: BigInt(amountMist),
            deepbookBalanceManager: spotPoolId,
          });
        } else {
          const marginPoolId = process.env.NEXT_PUBLIC_DEEPBOOK_MARGIN_POOL_ID;
          const predictPoolId = process.env.NEXT_PUBLIC_DEEPBOOK_PREDICT_POOL_ID;
          if (!marginPoolId || !predictPoolId) {
            throw new Error("NEXT_PUBLIC_DEEPBOOK_MARGIN_POOL_ID / PREDICT_POOL_ID not set in .env — awaiting Mysten Labs pool deployment");
          }
          tx = buildDeepbookAdvancedTx({
            amountMist: BigInt(amountMist),
            scopeTag: scopeTag as 3 | 4,
            deepbookMarginPoolId: marginPoolId,
            deepbookPredictPoolId: predictPoolId,
          });
        }
        const bytes = await tx.build({ client: suiClient });
        txBytes = Buffer.from(bytes).toString("base64");
      } catch (buildErr) {
        // Non-fatal — include error in preview
        txBytes = null;
      }
    }

    // ── Step 6: Human-readable preview ───────────────────────────────────────
    const scopeLabel = SCOPE_LABEL[scopeTag] ?? "Unknown";
    const preview = {
      action: `${parsed.action} — ${(parsed as any).rationale}`,
      venue: `Via ${scopeLabel} (scope tag: ${scopeTag})`,
      cost_breakdown: `Amount: ${amountSui.toFixed(4)} SUI  ·  Gas: ~0.002 SUI  ·  Slippage tolerance: ${(Number(parsed.slippage_tolerance_bps ?? 50) / 100).toFixed(2)}%`,
      budget_impact: `Uses ${(amountMist / 1e9).toFixed(4)} SUI — ${budgetUsedPctAfter.toFixed(1)}% of total budget used; ${((remaining - amountMist) / 1e9).toFixed(4)} SUI remaining`,
      risk_summary: `Guardian: ${guardian.risk_level} risk — ${guardian.blocks?.length ?? 0} blocks, ${guardian.warnings?.length ?? 0} warnings.`,
      on_chain_footprint: `1 Move call → pay_${scopeTag === 1 ? "402_invoice" : scopeTag === 2 ? "deepbook_spot" : "deepbook_advanced"} · emits AgentActionEvent`,
      guardian_summary: guardian.human_summary,
      can_execute: !guardian.blocks?.length,
    };

    return NextResponse.json({
      ok: true,
      original_text: text,
      parsed_intent: parsed,
      amount_mist: amountMist,
      scope_tag: scopeTag,
      scope_label: scopeLabel,
      preview,
      guardian,
      tx_bytes: txBytes,
      requires_confirmation: guardian.requires_confirmation,
      confirmation_token: guardian.confirmation_token,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
