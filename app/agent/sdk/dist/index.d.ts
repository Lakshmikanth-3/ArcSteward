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
export interface Velo402AgentConfig {
    /** Base URL of the Velo402 Next.js app. Defaults to http://localhost:3000 */
    apiBase?: string;
    /** Optional custom fetch implementation (e.g. for testing) */
    fetch?: typeof globalThis.fetch;
}
export interface PolicyStatus {
    policy: {
        id: string;
        exists: boolean;
        maxSpend: string;
        currentSpend: string;
        remainingBudget: string;
        expirationEpoch: number;
        allowedScopes: number[];
        attestedComputeRequired: boolean;
    };
    treasury: {
        balanceMist: string;
        label: string;
        id: string;
    };
    currentEpoch: number;
    epochsRemaining: number;
}
export interface GuardianResult {
    ok: boolean;
    risk_level: 'BLOCK' | 'HIGH' | 'MEDIUM' | 'LOW';
    risk_score: number;
    blocks: string[];
    warnings: string[];
    human_summary: string;
    requires_confirmation: boolean;
    confirmation_token: string | null;
    details: Record<string, unknown>;
    policy_snapshot?: Record<string, unknown>;
}
export interface TradeResult {
    ok: boolean;
    digest?: string;
    action: string;
    amount_mist: number;
    scope_tag: number;
    events?: unknown[];
    error?: string;
    blocked?: boolean;
    blocks?: string[];
}
export interface PaymentResult {
    ok: boolean;
    digest: string;
    data?: Record<string, unknown>;
    error?: string;
}
export interface YieldStatus {
    ok: boolean;
    treasury: {
        id: string;
        label: string;
        balance_mist: string;
        balance_sui: string;
        balance_usd: string;
    };
    yield: {
        scallop_market_id: string;
        apy_pct: string;
        exchange_rate: string;
        note: string;
    };
    pricing: {
        sui_usd: string;
        source: string;
    };
}
export interface SweepResult {
    ok: boolean;
    digest?: string;
    sweep_mist?: string;
    sweep_sui?: string;
    note?: string;
    error?: string;
}
export interface NautilusAttestation {
    ok: boolean;
    pcr0: string;
    source: string;
    policy_note: string;
    production_deployment: string;
}
/**
 * Velo402Agent — the main SDK entry point.
 *
 * All methods are pure HTTP — no private keys, no direct Sui SDK calls.
 * The Velo402 Next.js backend handles signing.
 */
export declare class Velo402Agent {
    private readonly base;
    private readonly _fetch;
    constructor(config?: Velo402AgentConfig);
    private _post;
    private _get;
    /**
     * Get the current PolicyCap state and Treasury balance.
     * Use this to check if the agent has budget before acting.
     */
    policyStatus(): Promise<PolicyStatus>;
    /**
     * Returns true if the agent has at least `minSui` SUI of remaining budget.
     */
    hasBudget(minSui?: number): Promise<boolean>;
    /**
     * Run the Guardian pre-flight risk check.
     * Always call this before trading — it checks Pyth oracle price,
     * PolicyCap budget, scope authorization, and duplicate-intent detection.
     *
     * @returns GuardianResult — if blocks.length > 0, do NOT proceed.
     */
    guardianCheck(params: {
        action: 'BUY' | 'SELL';
        amountSui: number;
        scopeTag: 1 | 2 | 3 | 4;
        intentKey?: string;
    }): Promise<GuardianResult>;
    /**
     * Execute a DeepBook trade.
     * Runs Guardian pre-flight automatically unless skipGuardian is true.
     *
     * scopeTag: 2 = Spot (SUI/DBUSDC), 3 = Margin (DEEP/SUI), 4 = Predict (WAL/SUI)
     */
    trade(params: {
        action: 'BUY' | 'SELL';
        amountSui: number;
        scopeTag: 2 | 3 | 4;
        skipGuardian?: boolean;
    }): Promise<TradeResult>;
    /**
     * Full HTTP 402 pay-and-retry cycle.
     *
     * 1. Hits the endpoint — expects 402 with payment details
     * 2. Calls /api/intent/parse to build + sign the PTB autonomously
     * 3. Retries the endpoint with the payment digest header
     *
     * Returns the decrypted data if successful, or throws on failure.
     */
    payAndFetch(knowledgeEndpoint: string, retries?: number): Promise<{
        data: Record<string, unknown>;
        digest: string;
    }>;
    /**
     * Get Treasury balance, Scallop APY, and Pyth SUI/USD price.
     */
    yieldStatus(): Promise<YieldStatus>;
    /**
     * Sweep idle Treasury funds into Scallop for yield.
     * Respects the 0.01 SUI reserve threshold automatically.
     */
    sweepToYield(idleAmountSui?: number): Promise<SweepResult>;
    /**
     * Fetch the Nautilus PCR0 attestation measurement.
     * Returns the PCR0 hash to include in attested PTBs.
     */
    getAttestation(): Promise<NautilusAttestation>;
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
    runCycle(opts?: {
        tradeAmountSui?: number;
        scopeTag?: 2 | 3 | 4;
        minBudgetSui?: number;
        knowledgeEndpoint?: string;
    }): Promise<{
        cycleId: string;
        budgetOk: boolean;
        paymentDigest?: string;
        tradeDigest?: string;
        sweepDigest?: string;
        guardianRisk?: string;
        skipped?: string;
    }>;
}
export declare const SCOPES: {
    readonly DATA_402: 1;
    readonly DEEPBOOK_SPOT: 2;
    readonly DEEPBOOK_MARGIN: 3;
    readonly DEEPBOOK_PREDICT: 4;
};
export declare const TESTNET_POOL_IDS: {
    readonly spot: "0x1c19362ca52b8ffd7a33cee805a67d40f31e6ba303753fd3a4cfdfacea7163a5";
    readonly margin: "0x48c95963e9eac37a316b7ae04a0deb761bcdcc2b67912374d6036e7f0e9bae9f";
    readonly predict: "0x8c1c1b186c4fddab1ebd53e0895a36c1d1b3b9a77cd34e607bef49a38af0150a";
};
export declare const TESTNET_OBJECTS: {
    readonly package: "0xd88c09bd00a9891035fdb1e975ada7a4ae6c220f2ddc2b06771d9d7eeb278c69";
    readonly treasury: "0x9cd52cd75dbb9743b9b67a9366a019d5b2bc6595aa8424839a64d8a1d78129fa";
    readonly registry: "0xe2077a155270ddf2b20241cd3194baad7c13fc07fd0f1e29f3468ef5247d674d";
};
