/**
 * @velo402/sdk — Velo402 Agent SDK
 *
 * A drop-in TypeScript client any AI agent framework can import to get:
 *   • Full HTTP 402 pay-and-retry cycle (Velo402 Payment Kit)
 *   • Guardian pre-flight risk check
 *   • PolicyCap budget introspection
 *   • DeepBook trade execution (Spot / Margin / Predict)
 *   • Seal + Walrus data decryption
 *
 * Usage:
 *   import { Velo402Agent } from '@velo402/sdk';
 *
 *   const agent = new Velo402Agent({
 *     apiBase: 'https://your-velo402-deployment.vercel.app',
 *   });
 *
 *   // Check policy budget
 *   const status = await agent.policyStatus();
 *
 *   // Pay a 402 invoice autonomously
 *   const result = await agent.payAndFetch('/api/knowledge/sentiment');
 *
 *   // Run Guardian pre-flight
 *   const risk = await agent.guardianCheck({ action: 'BUY', amountSui: 0.1, scopeTag: 2 });
 *   if (risk.blocks.length === 0) {
 *     await agent.trade({ action: 'BUY', amountSui: 0.1, scopeTag: 2 });
 *   }
 */
/**
 * Velo402Agent — the main SDK entry point.
 *
 * All methods are pure HTTP — no private keys, no direct Sui SDK calls.
 * The Velo402 Next.js backend handles signing.
 */
export class Velo402Agent {
    base;
    _fetch;
    constructor(config = {}) {
        this.base = (config.apiBase ?? 'http://localhost:3000').replace(/\/$/, '');
        this._fetch = config.fetch ?? globalThis.fetch.bind(globalThis);
    }
    async _post(path, body) {
        const res = await this._fetch(`${this.base}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        return data;
    }
    async _get(path) {
        const res = await this._fetch(`${this.base}${path}`);
        return res.json();
    }
    // ─── Policy & Budget ─────────────────────────────────────────────────────────
    /**
     * Get the current PolicyCap state and Treasury balance.
     * Use this to check if the agent has budget before acting.
     */
    async policyStatus() {
        return this._get('/api/policy/status');
    }
    /**
     * Returns true if the agent has at least `minSui` SUI of remaining budget.
     */
    async hasBudget(minSui = 0.01) {
        const status = await this.policyStatus();
        const remaining = Number(status.policy.remainingBudget) / 1e9;
        return remaining >= minSui;
    }
    // ─── Guardian Risk Engine ────────────────────────────────────────────────────
    /**
     * Run the Guardian pre-flight risk check.
     * Always call this before trading — it checks Pyth oracle price,
     * PolicyCap budget, scope authorization, and duplicate-intent detection.
     *
     * @returns GuardianResult — if blocks.length > 0, do NOT proceed.
     */
    async guardianCheck(params) {
        const amountMist = Math.round(params.amountSui * 1e9);
        return this._post('/api/guardian/analyze', {
            action: params.action,
            amountMist,
            scopeTag: params.scopeTag,
            intentKey: params.intentKey ?? `${params.action}:${params.scopeTag}:${amountMist}:${Date.now()}`,
        });
    }
    // ─── Trading ─────────────────────────────────────────────────────────────────
    /**
     * Execute a DeepBook trade.
     * Runs Guardian pre-flight automatically unless skipGuardian is true.
     *
     * scopeTag: 2 = Spot (SUI/DBUSDC), 3 = Margin (DEEP/SUI), 4 = Predict (WAL/SUI)
     */
    async trade(params) {
        return this._post('/api/trade/deepbook', {
            action: params.action,
            amountMist: Math.round(params.amountSui * 1e9),
            scopeTag: params.scopeTag,
            skipGuardian: params.skipGuardian ?? false,
        });
    }
    // ─── 402 Payment Loop ────────────────────────────────────────────────────────
    /**
     * Full HTTP 402 pay-and-retry cycle.
     *
     * 1. Hits the endpoint — expects 402 with payment details
     * 2. Calls /api/intent/parse to build + sign the PTB autonomously
     * 3. Retries the endpoint with the payment digest header
     *
     * Returns the decrypted data if successful, or throws on failure.
     */
    async payAndFetch(knowledgeEndpoint, retries = 1) {
        // Step 1: Hit endpoint, collect 402 challenge
        const challengeRes = await this._fetch(`${this.base}${knowledgeEndpoint}`);
        if (challengeRes.status !== 402) {
            if (challengeRes.ok) {
                const data = await challengeRes.json();
                return { data, digest: '' };
            }
            throw new Error(`Unexpected status ${challengeRes.status} from ${knowledgeEndpoint}`);
        }
        const challenge = await challengeRes.json();
        // Step 2: Pay via intent/parse
        const payResult = await this._post('/api/intent/parse', {
            scopeTag: 1, // DATA_402
            action: 'BUY',
            amountMist: challenge.amount_mist,
            requestHash: challenge.request_hash,
        });
        if (!payResult.ok || !payResult.digest) {
            throw new Error(`Payment failed: ${payResult.error ?? 'unknown error'}`);
        }
        // Step 3: Retry with proof
        const dataRes = await this._fetch(`${this.base}${knowledgeEndpoint}`, {
            headers: {
                'X-Payment-Digest': payResult.digest,
                'X-Request-Hash': challenge.request_hash,
            },
        });
        if (!dataRes.ok) {
            throw new Error(`Data fetch failed after payment: HTTP ${dataRes.status}`);
        }
        const data = await dataRes.json();
        return { data, digest: payResult.digest };
    }
    // ─── Treasury Yield ──────────────────────────────────────────────────────────
    /**
     * Get Treasury balance, Scallop APY, and Pyth SUI/USD price.
     */
    async yieldStatus() {
        return this._get('/api/treasury/yield/status');
    }
    /**
     * Sweep idle Treasury funds into Scallop for yield.
     * Respects the 0.01 SUI reserve threshold automatically.
     */
    async sweepToYield(idleAmountSui) {
        return this._post('/api/treasury/yield/sweep', {
            idleAmountMist: idleAmountSui ? Math.round(idleAmountSui * 1e9) : undefined,
        });
    }
    // ─── Nautilus Attestation ────────────────────────────────────────────────────
    /**
     * Fetch the Nautilus PCR0 attestation measurement.
     * Returns the PCR0 hash to include in attested PTBs.
     */
    async getAttestation() {
        return this._post('/api/compute/attest', {});
    }
    // ─── Autonomous Loop Helper ───────────────────────────────────────────────────
    /**
     * Run one complete autonomous agent cycle:
     *   1. Check budget → skip if insufficient
     *   2. Fetch sentiment data (pay 402 invoice automatically)
     *   3. Run Guardian check on the proposed trade
     *   4. Execute trade if Guardian approves
     *   5. Sweep idle funds to yield
     *
     * @returns Summary of what happened this cycle
     */
    async runCycle(opts = {}) {
        const cycleId = crypto.randomUUID().slice(0, 8);
        const tradeAmountSui = opts.tradeAmountSui ?? 0.05;
        const scopeTag = opts.scopeTag ?? 2;
        const minBudgetSui = opts.minBudgetSui ?? 0.01;
        const knowledgeEndpoint = opts.knowledgeEndpoint ?? '/api/knowledge/sentiment';
        // 1. Budget check
        const budgetOk = await this.hasBudget(minBudgetSui);
        if (!budgetOk) {
            return { cycleId, budgetOk: false, skipped: 'insufficient_budget' };
        }
        // 2. Pay and fetch knowledge
        let paymentDigest;
        let sentimentData = {};
        try {
            const result = await this.payAndFetch(knowledgeEndpoint);
            paymentDigest = result.digest;
            sentimentData = result.data;
        }
        catch (e) {
            return { cycleId, budgetOk, paymentDigest, skipped: `knowledge_fetch_failed: ${e}` };
        }
        // 3. Guardian check
        const sentiment = sentimentData?.sentiment ?? 'NEUTRAL';
        const action = sentiment === 'BULLISH' ? 'BUY' : sentiment === 'BEARISH' ? 'SELL' : null;
        if (!action) {
            return { cycleId, budgetOk, paymentDigest, skipped: 'hold_signal' };
        }
        const risk = await this.guardianCheck({ action, amountSui: tradeAmountSui, scopeTag });
        if (risk.blocks.length > 0) {
            return { cycleId, budgetOk, paymentDigest, guardianRisk: risk.risk_level, skipped: `guardian_blocked: ${risk.blocks.join(',')}` };
        }
        // 4. Trade
        let tradeDigest;
        const trade = await this.trade({ action, amountSui: tradeAmountSui, scopeTag, skipGuardian: true });
        if (trade.ok && trade.digest)
            tradeDigest = trade.digest;
        // 5. Yield sweep (non-blocking — ignore errors)
        let sweepDigest;
        try {
            const sweep = await this.sweepToYield();
            if (sweep.ok && sweep.digest)
                sweepDigest = sweep.digest;
        }
        catch { /* sweep is best-effort */ }
        return { cycleId, budgetOk, paymentDigest, guardianRisk: risk.risk_level, tradeDigest, sweepDigest };
    }
}
// Re-export constants for SDK consumers
export const SCOPES = {
    DATA_402: 1,
    DEEPBOOK_SPOT: 2,
    DEEPBOOK_MARGIN: 3,
    DEEPBOOK_PREDICT: 4,
};
export const TESTNET_POOL_IDS = {
    spot: '0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5',
    margin: '0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f',
    predict: '0x8c1c1b186c4fddab1ebd53e0895a36c1d1b3b9a77cd34e607bef49a38af0150a',
};
export const TESTNET_OBJECTS = {
    package: '0xd88c09bd00a9891035fdb1e975ada7a4ae6c220f2ddc2b06771d9d7eeb278c69',
    treasury: '0x9cd52cd75dbb9743b9b67a9366a019d5b2bc6595aa8424839a64d8a1d78129fa',
    registry: '0xe2077a155270ddf2b20241cd3194baad7c13fc07fd0f1e29f3468ef5247d674d',
};
