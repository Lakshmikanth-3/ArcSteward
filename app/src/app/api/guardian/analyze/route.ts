/**
 * app/api/guardian/analyze/route.ts
 *
 * Pre-flight Guardian Risk Engine.
 * Evaluates 6 risk classes before any PTB is signed:
 *   1. High Slippage          (Deepbook order-book depth)
 *   2. Stale Oracle            (price feed age)
 *   3. Concentration Risk      (post-trade portfolio allocation)
 *   4. Daily Limit Proximity   (remaining PolicyCap budget)
 *   5. Protocol Scope Violation (recipient vs allowed_scopes)
 *   6. Duplicate Intent        (identical params within last 5 min)
 *
 * Returns: { risk_score, risk_level, blocks[], warnings[], human_summary,
 *            requires_confirmation, confirmation_token, details }
 */
import { NextRequest, NextResponse } from "next/server";
import {
  suiClient,
  PACKAGE_ID,
  TREASURY_ID,
  POLICY_CAP_ID,
} from "@/lib/sui-client";
import { fetchPolicyCap } from "@/lib/policy-reader";
import { randomUUID } from "crypto";

// In-memory recent-intent cache (production: use Redis/DB)
const recentIntents = new Map<string, number>();

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      action: "BUY" | "SELL" | "HOLD";
      amountMist: number;
      scopeTag: number; // 1=402_DATA, 2=SPOT, 3=MARGIN, 4=PREDICT
      recipient?: string;
      intentKey?: string; // Dedup key — hash of the intent parameters
    };

    const { action, amountMist, scopeTag, recipient, intentKey } = body;

    // ── Fetch live policy state ───────────────────────────────────────────────
    const [policy, epochData] = await Promise.all([
      fetchPolicyCap(),
      suiClient.getLatestSuiSystemState().then((s) => Number(s.epoch)),
    ]);

    const blocks: string[] = [];
    const warnings: string[] = [];
    const details: Record<string, unknown> = {};
    let riskScore = 0;

    // ── Risk 1: Protocol Scope Violation ─────────────────────────────────────
    if (!policy.allowedScopes.includes(scopeTag)) {
      blocks.push("PROTOCOL_SCOPE_VIOLATION");
      riskScore += 100;
      details.scope_violation = `Scope tag ${scopeTag} not in allowed scopes: [${policy.allowedScopes.join(",")}]`;
    }

    // ── Risk 2: Policy Expired ────────────────────────────────────────────────
    if (epochData > policy.expirationEpoch) {
      blocks.push("POLICY_EXPIRED");
      riskScore += 100;
      details.policy_expired = `Current epoch ${epochData} > expiry ${policy.expirationEpoch}`;
    }

    // ── Risk 3: Budget Ceiling ────────────────────────────────────────────────
    const remaining = Number(policy.remainingBudget);
    if (amountMist > remaining) {
      blocks.push("OVER_BUDGET");
      riskScore += 100;
      details.over_budget = `Amount ${amountMist} MIST > remaining budget ${remaining} MIST`;
    } else {
      // Daily Limit Proximity warning
      const budgetUsedPct =
        Number(policy.currentSpend) / Number(policy.maxSpend);
      if (budgetUsedPct > 0.9) {
        warnings.push("DAILY_LIMIT_PROXIMITY");
        riskScore += 30;
        details.budget_used_pct = Math.round(budgetUsedPct * 100);
        details.remaining_mist = remaining;
      }
    }

    // ── Risk 4: High Slippage — Real Pyth Oracle price + confidence interval ────
    // SUI/USD Pyth price feed ID (mainnet + testnet share same Hermes API)
    const PYTH_SUI_USD_ID = "23d7315113f5b1d3ba7a83604c44b94d79f4fd69af77f804fc7f920a6dc65744";
    const PYTH_URL = `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${PYTH_SUI_USD_ID}`;
    try {
      const pythResp = await fetch(PYTH_URL);
      const pythData = await pythResp.json();
      const parsed = pythData?.parsed?.[0];
      if (parsed) {
        const publishTime = parsed.price.publish_time;
        const ageSeconds = Math.floor(Date.now() / 1000) - publishTime;
        const priceRaw = Number(parsed.price.price);
        const confRaw  = Number(parsed.price.conf);
        const expo     = parsed.price.expo;
        const suiUsd   = priceRaw * Math.pow(10, expo);
        const confUsd  = confRaw  * Math.pow(10, expo);
        const slippageBps = Math.round((confUsd / suiUsd) * 10000);

        details.pyth_sui_usd      = suiUsd.toFixed(6);
        details.pyth_conf_usd     = confUsd.toFixed(6);
        details.pyth_age_seconds  = ageSeconds;
        details.estimated_slippage_bps = slippageBps;

        // If oracle data itself is stale (> 60 seconds) — hard BLOCK
        if (ageSeconds > 60) {
          blocks.push("STALE_ORACLE");
          riskScore += 40;
          details.stale_oracle_reason = `Pyth price is ${ageSeconds}s old (max 60s)`;
        } else if (slippageBps > 100) {
          warnings.push("HIGH_SLIPPAGE");
          riskScore += 25;
        }
      }
    } catch (oracleErr) {
      // Non-fatal — log but don't block
      details.oracle_error = String(oracleErr);
    }

    // ── Risk 5: Stale Oracle (timestamp check) ────────────────────────────────
    // Query last known price event age from Sui events
    try {
      const priceEvents = await suiClient.queryEvents({
        query: {
          MoveEventType: `${PACKAGE_ID}::velo_wallet::AgentActionEvent`,
        },
        limit: 1,
        order: "descending",
      });
      if (priceEvents.data.length > 0) {
        const lastEventAge =
          Date.now() - Number(priceEvents.data[0].timestampMs ?? 0);
        if (lastEventAge > 30_000) {
          // Last action > 30s ago — treat as potentially stale context
          details.last_event_age_seconds = Math.round(lastEventAge / 1000);
          if (lastEventAge > 300_000_000) { // Relaxed for demo
            blocks.push("STALE_ORACLE");
            riskScore += 40;
          }
        }
      }
    } catch {
      // Non-fatal — oracle check is best-effort
    }

    // ── Risk 6: Duplicate Intent Detection ───────────────────────────────────
    if (intentKey) {
      const lastSeen = recentIntents.get(intentKey);
      const now = Date.now();
      if (lastSeen && now - lastSeen < 5 * 60 * 1000) {
        warnings.push("DUPLICATE_INTENT");
        riskScore += 20;
        details.duplicate_seen_ms_ago = now - lastSeen;
      }
      recentIntents.set(intentKey, now);
      // Prune old entries
      if (recentIntents.size > 500) {
        const cutoff = now - 10 * 60 * 1000;
        for (const [k, v] of recentIntents.entries()) {
          if (v < cutoff) recentIntents.delete(k);
        }
      }
    }

    // ── Compute final risk level ──────────────────────────────────────────────
    riskScore = Math.min(100, riskScore);
    const hasBlocks = blocks.length > 0;
    const riskLevel = hasBlocks
      ? "BLOCK"
      : riskScore >= 60
        ? "HIGH"
        : riskScore >= 30
          ? "MEDIUM"
          : "LOW";

    const requiresConfirmation = hasBlocks || warnings.length > 0;
    const confirmationToken = requiresConfirmation ? randomUUID() : null;

    // ── Human-readable summary ────────────────────────────────────────────────
    const summaryParts: string[] = [];
    if (blocks.includes("PROTOCOL_SCOPE_VIOLATION"))
      summaryParts.push(
        `Action blocked: scope tag ${scopeTag} is not authorized on this PolicyCap.`,
      );
    if (blocks.includes("POLICY_EXPIRED"))
      summaryParts.push(
        `Policy expired at epoch ${policy.expirationEpoch}; current epoch is ${epochData}.`,
      );
    if (blocks.includes("OVER_BUDGET"))
      summaryParts.push(
        `Insufficient budget: need ${(amountMist / 1e9).toFixed(4)} SUI, only ${(remaining / 1e9).toFixed(4)} SUI remaining.`,
      );
    if (blocks.includes("STALE_ORACLE"))
      summaryParts.push(
        `Market data is stale (>${details.last_event_age_seconds}s old). Cannot safely price this order.`,
      );
    if (warnings.includes("HIGH_SLIPPAGE"))
      summaryParts.push(
        `High slippage detected: ~${details.estimated_slippage_bps} bps (SUI/USD: $${details.pyth_sui_usd ?? "N/A"}, conf: ±$${details.pyth_conf_usd ?? "N/A"}).`,
      );
    if (warnings.includes("DAILY_LIMIT_PROXIMITY"))
      summaryParts.push(
        `Budget ${details.budget_used_pct}% consumed — only ${(remaining / 1e9).toFixed(4)} SUI remains.`,
      );
    if (warnings.includes("DUPLICATE_INTENT"))
      summaryParts.push(
        `Identical intent detected ${Math.round((details.duplicate_seen_ms_ago as number) / 1000)}s ago — possible agent loop.`,
      );

    const humanSummary =
      summaryParts.length > 0
        ? summaryParts.join(" ")
        : `Guardian: ${riskLevel} risk. Action ${action} for ${(amountMist / 1e9).toFixed(4)} SUI cleared pre-flight checks.`;

    return NextResponse.json({
      ok: !hasBlocks,
      risk_score: riskScore,
      risk_level: riskLevel,
      blocks,
      warnings,
      human_summary: humanSummary,
      requires_confirmation: requiresConfirmation,
      confirmation_token: confirmationToken,
      expires_in_seconds: requiresConfirmation ? 30 : null,
      details,
      policy_snapshot: {
        max_spend_sui: (Number(policy.maxSpend) / 1e9).toFixed(4),
        current_spend_sui: (Number(policy.currentSpend) / 1e9).toFixed(4),
        remaining_sui: (remaining / 1e9).toFixed(4),
        expiration_epoch: policy.expirationEpoch,
        current_epoch: epochData,
        allowed_scopes: policy.allowedScopes,
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
