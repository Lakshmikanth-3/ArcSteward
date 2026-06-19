/**
 * agent/agent-runner.ts
 *
 * Autonomous agent main loop. Runs as a standalone Node process.
 * Reads its configuration from environment variables and executes
 * the full Velo402 loop:
 *
 *   1. Check budget (PolicyCap remaining)
 *   2. Hit Knowledge endpoint → 402 challenge → pay_402_invoice PTB → get blob_id
 *   3. Decrypt Walrus blob via Seal
 *   4. Decide BUY/SELL/HOLD from decoded sentiment score
 *   5. Fetch Nautilus attestation (if PolicyCap.attested_compute_required)
 *   6. Run Guardian pre-flight
 *   7. Execute DeepBook trade (spot / margin / predict)
 *   8. Sweep idle balance to Scallop yield
 */
import { Velo402Agent } from './sdk/index.js';

// ─── Config ──────────────────────────────────────────────────────────────────
const NEXT_APP = process.env.NEXT_APP_URL ?? 'http://localhost:3000';
const KNOWLEDGE_PATH = '/api/knowledge/sentiment';

// ─── Agent client (pure HTTP, backend signs with AGENT_PRIVATE_KEY) ──────────
const agent = new Velo402Agent({ apiBase: NEXT_APP });

// ─── Main loop ────────────────────────────────────────────────────────────────
async function runAgentLoop() {
  log('Velo402 Agent started.');
  log(`Backend : ${NEXT_APP}`);
  log(`Network : ${process.env.NEXT_PUBLIC_SUI_NETWORK ?? 'testnet'}`);
  log(`Package : ${process.env.NEXT_PUBLIC_VELO402_PACKAGE_ID ?? '(from backend env)'}`);

  await agentCycle();

  log(`[AGENT] Cycle completed. Exiting.`);
  process.exit(0);
}

async function agentCycle() {
  log('─── New agent cycle ───────────────────────────────');

  // ── Step 1: Budget check ──────────────────────────────────────────────────
  let policyStatus;
  try {
    policyStatus = await agent.policyStatus();
  } catch (err) {
    log(`[AGENT] Could not fetch policy status: ${err}`);
    return;
  }

  const remainingMist = BigInt(policyStatus.policy.remainingBudget);
  const minRequired = BigInt(50_000_000); // 0.05 SUI
  if (remainingMist < minRequired) {
    log(`[AGENT] Insufficient budget: ${remainingMist} MIST remaining (need ${minRequired}). Exiting.`);
    return;
  }
  log(`[AGENT] Budget OK: ${remainingMist} MIST remaining · epoch ${policyStatus.currentEpoch} / ${policyStatus.policy.expirationEpoch}`);

  // ── Step 2: 402 Knowledge fetch ───────────────────────────────────────────
  log(`[AGENT] Hitting 402 knowledge endpoint…`);
  let blobId: string | null = null;
  let requestHash: string | null = null;
  let paymentDigest: string | null = null;

  try {
    // 2a. Initial request — expect 402 challenge
    const challengeRes = await fetch(`${NEXT_APP}${KNOWLEDGE_PATH}`);
    if (challengeRes.status !== 402) {
      throw new Error(`Expected 402, got ${challengeRes.status}`);
    }
    const challenge = await challengeRes.json() as {
      amount_mist: string;
      request_hash: string;
      recipient: string;
    };
    requestHash = challenge.request_hash;
    log(`[AGENT] 402 challenge received. nonce=${requestHash} amount=${challenge.amount_mist} MIST`);

    // 2b. Pay via the intent/parse route (which builds + signs + submits the PTB server-side)
    const payRes = await fetch(`${NEXT_APP}/api/intent/parse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Pay 402 data invoice of ${Number(challenge.amount_mist) / 1e9} SUI`,
      }),
    });
    const payData = await payRes.json() as { ok?: boolean; digest?: string; error?: string; tx_bytes?: string };

    // The intent/parse route builds the PTB but doesn't submit (the agent must sign).
    // The actual execution happens when the agent signs via the trade/deepbook route.
    // For the 402 flow, we call api/agent/provision which auto-executes.
    // Use the direct 402 pay route instead:
    const directPayRes = await fetch(`${NEXT_APP}/api/agent/pay402`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amountMist: challenge.amount_mist,
        nonce: requestHash,
        recipient: challenge.recipient,
      }),
    });
    const directPay = await directPayRes.json() as { ok?: boolean; digest?: string; error?: string };

    if (!directPay.ok || !directPay.digest) {
      log(`[AGENT] 402 payment failed: ${directPay.error ?? 'no digest returned'}`);
      return;
    }
    paymentDigest = directPay.digest;
    log(`[AGENT] 402 payment submitted. digest=${paymentDigest}`);

    // 2c. Retry with payment proof
    const dataRes = await fetch(`${NEXT_APP}${KNOWLEDGE_PATH}`, {
      headers: {
        'x-velo402-payment-digest': paymentDigest,
        'x-velo402-request-hash': requestHash,
      },
    });
    if (!dataRes.ok) {
      throw new Error(`Knowledge endpoint returned ${dataRes.status} after payment`);
    }
    const dataPayload = await dataRes.json() as { ok?: boolean; blob_id?: string; request_hash?: string };
    blobId = dataPayload.blob_id ?? null;
    log(`[AGENT] Knowledge access granted. blob_id=${blobId}`);
  } catch (err) {
    log(`[AGENT] 402 flow failed: ${err}`);
    return;
  }

  if (!blobId || !requestHash) {
    log('[AGENT] No blob_id in response. Cannot decrypt.');
    return;
  }

  // ── Step 3: Decrypt Walrus blob via Seal ──────────────────────────────────
  log(`[AGENT] Fetching blob from Walrus and decrypting via Seal…`);
  let sentimentScore = 0;
  try {
    const sealRes = await fetch(`${NEXT_APP}/api/knowledge/decrypt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blobId, requestHash }),
    });
    const sealData = await sealRes.json() as { ok?: boolean; data?: { score?: number }; score?: number; error?: string };
    if (!sealRes.ok || sealData.error) {
      throw new Error(sealData.error ?? `Seal decrypt HTTP ${sealRes.status}`);
    }
    sentimentScore = sealData.data?.score ?? sealData.score ?? 0;
    log(`[AGENT] Decrypted sentiment score: ${sentimentScore.toFixed(4)}`);
  } catch (err) {
    log(`[AGENT] Walrus/Seal decrypt failed: ${err}. Using blob metadata for decision.`);
    // Score stays at 0 → HOLD → safe exit
  }

  // ── Step 4: Trade decision ────────────────────────────────────────────────
  const { action, amountMist, scopeTag } = decide(sentimentScore);
  log(`[AGENT] Decision: ${action} · ${amountMist} MIST · scope ${scopeTag}`);

  if (action === 'HOLD') {
    log('[AGENT] HOLD signal. No trade this cycle.');
    // Still sweep idle to yield
    await sweepToYield();
    return;
  }

  // ── Step 5: Nautilus attestation (if required by PolicyCap) ──────────────
  let pcr0: string | null = null;
  if (policyStatus.policy.attestedComputeRequired) {
    log(`[AGENT] PolicyCap requires TEE attestation. Fetching Nautilus PCR0…`);
    try {
      const attestRes = await fetch(`${NEXT_APP}/api/compute/attest`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
      const attest = await attestRes.json() as { ok?: boolean; pcr0?: string; source?: string; error?: string };
      if (!attest.ok || !attest.pcr0) {
        throw new Error(attest.error ?? 'PCR0 not returned');
      }
      pcr0 = attest.pcr0;
      log(`[AGENT] Attestation OK. PCR0=${pcr0.slice(0, 16)}… source=${attest.source}`);
    } catch (err) {
      log(`[AGENT] Nautilus attestation failed: ${err}. Aborting trade (TEE required).`);
      return;
    }
  } else {
    log(`[AGENT] TEE attestation not required for this PolicyCap.`);
  }

  // ── Step 6: Guardian pre-flight ───────────────────────────────────────────
  log(`[AGENT] Running Guardian pre-flight…`);
  try {
    const risk = await agent.guardianCheck({
      action: action as 'BUY' | 'SELL',
      amountSui: Number(amountMist) / 1e9,
      scopeTag: scopeTag as 1 | 2 | 3 | 4,
      intentKey: `${action}:${scopeTag}:${amountMist}:${Date.now()}`,
    });
    log(`[AGENT] Guardian: ${risk.risk_level} · blocks=[${risk.blocks.join(',')}] · warnings=[${risk.warnings.join(',')}]`);
    log(`[AGENT] Guardian summary: ${risk.human_summary}`);

    if (risk.blocks.length > 0) {
      log(`[AGENT] Guardian BLOCKED trade. Skipping.`);
      await sweepToYield();
      return;
    }
  } catch (err) {
    log(`[AGENT] Guardian check failed: ${err}. Proceeding with caution.`);
  }

  // ── Step 7: Execute trade ─────────────────────────────────────────────────
  log(`[AGENT] Executing ${action} ${Number(amountMist)/1e9} SUI via scope ${scopeTag}…`);
  try {
    const tradeRes = await fetch(`${NEXT_APP}/api/trade/deepbook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        amountMist: Number(amountMist),
        scopeTag,
        skipGuardian: true, // Already ran above
        pcr0: pcr0 ?? undefined,
      }),
    });
    const trade = await tradeRes.json() as { ok?: boolean; digest?: string; error?: string; blocked?: boolean; blocks?: string[] };

    if (!trade.ok) {
      if (trade.blocked) {
        log(`[AGENT TRADE BLOCKED] ${trade.blocks?.join(', ')}`);
      } else {
        log(`[AGENT TRADE ERROR] ${trade.error}`);
      }
    } else {
      log(`[AGENT TRADE SUCCESS] digest=${trade.digest}`);
    }
  } catch (err) {
    log(`[AGENT TRADE ERROR] ${err}`);
  }

  // ── Step 8: Sweep idle to yield ───────────────────────────────────────────
  await sweepToYield();
}

// ─── Yield sweep ──────────────────────────────────────────────────────────────
async function sweepToYield() {
  try {
    const sweepRes = await fetch(`${NEXT_APP}/api/treasury/yield/sweep`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    const sweep = await sweepRes.json() as { ok?: boolean; digest?: string; sweep_sui?: string; error?: string };
    if (sweep.ok) {
      log(`[AGENT YIELD] Swept ${sweep.sweep_sui} SUI to Scallop. digest=${sweep.digest}`);
    } else {
      log(`[AGENT YIELD] Sweep skipped or failed: ${sweep.error}`);
    }
  } catch (err) {
    log(`[AGENT YIELD] Sweep call failed: ${err}`);
  }
}

// ─── Decision function ────────────────────────────────────────────────────────
function decide(score: number): { action: string; amountMist: bigint; scopeTag: number } {
  if (score > 0.6) {
    const confidence = score;
    return {
      action: 'BUY',
      amountMist: BigInt(100_000_000), // 0.1 SUI
      scopeTag: confidence > 0.85 ? 3 : 2, // margin if high confidence, else spot
    };
  } else if (score < -0.5) {
    return {
      action: 'SELL',
      amountMist: BigInt(50_000_000), // 0.05 SUI — hedge via Predict
      scopeTag: 4,
    };
  }
  return { action: 'HOLD', amountMist: BigInt(0), scopeTag: 2 };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

// ─── Entry point ─────────────────────────────────────────────────────────────
runAgentLoop().catch((err) => {
  console.error('Fatal agent error:', err);
  process.exit(1);
});
