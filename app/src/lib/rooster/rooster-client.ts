/**
 * lib/rooster/rooster-client.ts
 * Real REST client for Rooster Agents' Agent Economy API
 * (https://roosteragents.ai/agent-economy/). SERVER-SIDE ONLY — reads
 * ROOSTER_AGENT_KEY via config.ts; never import this from a client component.
 *
 * Endpoints (confirmed against the live discovery doc, not guessed):
 *   GET  /creators.json          — public, no auth
 *   GET  /benchmarks.json        — public, no auth
 *   POST /offer                  — requires Authorization: Bearer <key>
 *   GET  /offer-status/{id}      — requires Authorization: Bearer <key>
 *
 * There is no documented standalone REST endpoint for a single creator by
 * code — only the MCP get_creator tool and the bulk creators.json list — so
 * getCreator() derives from listCreators().
 */
import { getRoosterConfig, type RoosterConfig } from "./config";
import { roosterLogger } from "./logger";
import {
  OFFER_LIFECYCLE_SET,
  RoosterApiError,
  TERMINAL_OFFER_STATES,
  type Creator,
  type Currency,
  type MarketBenchmark,
  type Offer,
  type OfferInput,
  type OfferLifecycle,
  type OfferState,
  type OfferStatus,
} from "./types";

export interface RoosterClientConfig {
  config?: RoosterConfig;
  fetchImpl?: typeof globalThis.fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** Minimum ms between outgoing calls — a conservative client-side throttle. */
  minIntervalMs?: number;
}

const STATE_MAP: Record<string, OfferState> = {
  pending: "pending",
  // Real Rooster status strings observed live against real testMode
  // submissions (confirmed 2026-08-24) — not guessed from docs alone.
  pending_human_decision: "pending",
  posted_simulated: "posted_simulated",
  accepted: "accepted",
  rejected: "rejected",
  countered: "countered",
  provisioning: "provisioning",
  awaiting_funding: "awaiting_funding",
  funded: "funded",
  releasing: "releasing",
  released: "released",
  refunded: "refunded",
  expired_unfunded: "expired_unfunded",
  awaiting_payout_wallet: "awaiting_payout_wallet",
};

function normalizeState(raw: unknown): OfferState {
  if (typeof raw !== "string") return "unknown";
  return STATE_MAP[raw.toLowerCase()] ?? "unknown";
}

function normalizeLifecycle(raw: unknown): OfferLifecycle {
  if (typeof raw === "string" && OFFER_LIFECYCLE_SET.has(raw)) return raw as OfferLifecycle;
  return "unknown";
}

interface ParsedFunding {
  depositAddress: string;
  amountCents: number;
  amountUsdc: string;
  currency: Currency;
  deadline?: string;
  tokenContract?: `0x${string}`;
  tokenDecimals?: number;
  explorer?: string;
}

/**
 * Normalizes every funding-response shape Rooster is known to send into one
 * canonical representation. Confirmed live 2026-08-24/25/26:
 *   deposit_address / amount_usdc   — snake_case, amount as a decimal string ("5.75")
 *   depositAddress / amountUsdc     — camelCase, same decimal-string amount
 *   amountUsdcCents                 — integer cents (e.g. 575)
 *   token_contract / tokenContract  — the ERC-20 to send to; DIFFERS between
 *                                     Base Sepolia and Base mainnet USDC, so
 *                                     this must always be read here, never
 *                                     assumed from a fixed constant.
 * Amount math never touches floating point on the string itself — an
 * incoming cents field is used directly as an integer; an incoming decimal
 * string/number is rounded through cents once, and amountUsdc is always
 * re-derived FROM those integer cents (cents/100).toFixed(2), never by
 * echoing back a possibly-imprecise input string.
 */
function parseFunding(fundingRaw: Record<string, unknown>): ParsedFunding {
  const depositAddress = String(
    fundingRaw.depositAddress ?? fundingRaw.deposit_address ?? fundingRaw.address ?? "",
  );

  const centsField = fundingRaw.amountUsdcCents ?? fundingRaw.amountCents ?? fundingRaw.amount_cents;
  const usdField = fundingRaw.amount_usdc ?? fundingRaw.amountUsdc;

  const amountCents =
    centsField !== undefined
      ? Math.round(Number(centsField))
      : usdField !== undefined
        ? Math.round(Number(usdField) * 100)
        : 0;

  const tokenContractRaw = fundingRaw.token_contract ?? fundingRaw.tokenContract;
  const tokenDecimalsRaw = fundingRaw.token_decimals ?? fundingRaw.tokenDecimals;

  return {
    depositAddress,
    amountCents,
    amountUsdc: (amountCents / 100).toFixed(2),
    currency: ((fundingRaw.currency as Currency | undefined) ?? "USDC") as Currency,
    deadline: fundingRaw.deadline as string | undefined,
    tokenContract: typeof tokenContractRaw === "string" ? (tokenContractRaw as `0x${string}`) : undefined,
    tokenDecimals: typeof tokenDecimalsRaw === "number" ? tokenDecimalsRaw : undefined,
    explorer: typeof fundingRaw.explorer === "string" ? fundingRaw.explorer : undefined,
  };
}

export class RoosterClient {
  private readonly cfg: RoosterConfig;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly minIntervalMs: number;
  private lastCallAt = 0;

  constructor(opts: RoosterClientConfig = {}) {
    this.cfg = opts.config ?? getRoosterConfig();
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxRetries = opts.maxRetries ?? 2;
    this.minIntervalMs = opts.minIntervalMs ?? 200;

    if (!this.cfg.baseUrl.startsWith("https://") && !this.cfg.baseUrl.includes("localhost")) {
      throw new Error(`RoosterClient requires HTTPS (got "${this.cfg.baseUrl}").`);
    }
  }

  private async throttle(): Promise<void> {
    const elapsed = Date.now() - this.lastCallAt;
    if (elapsed < this.minIntervalMs) {
      await new Promise((r) => setTimeout(r, this.minIntervalMs - elapsed));
    }
    this.lastCallAt = Date.now();
  }

  private async request<T>(
    path: string,
    opts: { method?: string; body?: unknown; auth?: boolean } = {},
  ): Promise<T> {
    const method = opts.method ?? "GET";
    const url = `${this.cfg.baseUrl}${path}`;
    const totalAttempts = this.maxRetries + 1;

    let lastErr: unknown;
    for (let attempt = 1; attempt <= totalAttempts; attempt++) {
      await this.throttle();

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (opts.auth !== false) {
          headers.Authorization = `Bearer ${this.cfg.apiKey}`;
        }

        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: controller.signal,
        });

        if ((res.status === 429 || res.status >= 500) && attempt < totalAttempts) {
          const backoffMs = 300 * 2 ** (attempt - 1);
          roosterLogger.warn("Rooster API transient error — retrying", {
            path,
            status: res.status,
            attempt,
            backoffMs,
          });
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        const text = await res.text();
        let json: unknown;
        if (text) {
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined; // non-JSON body — surfaced via res.ok check below
          }
        }

        if (!res.ok) {
          throw new RoosterApiError(
            `Rooster API ${method} ${path} failed with HTTP ${res.status}.`,
            res.status,
            json,
          );
        }

        return json as T;
      } catch (err) {
        if (err instanceof RoosterApiError) throw err;
        const isAbort = err instanceof Error && err.name === "AbortError";
        lastErr = err;
        if (isAbort && attempt < totalAttempts) continue;
        // Never leak the Authorization header value — rethrow a sanitized error.
        const message = err instanceof Error ? err.message : String(err);
        throw new RoosterApiError(`Rooster API ${method} ${path} request failed: ${message}`);
      } finally {
        clearTimeout(timeout);
      }
    }

    // Unreachable in practice — the loop always returns or throws — but keeps TS happy.
    const message = lastErr instanceof Error ? lastErr.message : String(lastErr);
    throw new RoosterApiError(`Rooster API ${method} ${path} exhausted retries: ${message}`);
  }

  async listCreators(platform?: string): Promise<Creator[]> {
    const data = await this.request<unknown>(`/creators.json`, { auth: false });
    const list = Array.isArray(data)
      ? data
      : ((data as { creators?: unknown[] })?.creators ?? []);
    // Real shape confirmed live (2026-08-24): the creator code is under
    // "creator" (not "code"/"creatorCode"), and "platforms" is an array of
    // { network, handle, followers, ... } connection objects, not bare
    // platform-name strings.
    const creators: Creator[] = (list as Record<string, unknown>[]).map((c) => {
      const rawPlatforms = Array.isArray(c.platforms) ? (c.platforms as Record<string, unknown>[]) : [];
      return {
        code: String(c.creator ?? c.code ?? c.creatorCode ?? ""),
        platforms: rawPlatforms.map((p) => p.network) as Creator["platforms"],
        raw: c,
      };
    });
    return platform ? creators.filter((c) => (c.platforms as string[]).includes(platform)) : creators;
  }

  async getCreator(code: string): Promise<Creator | undefined> {
    const creators = await this.listCreators();
    return creators.find((c) => c.code.toLowerCase() === code.toLowerCase());
  }

  async getMarketBenchmarks(): Promise<MarketBenchmark> {
    const data = await this.request<unknown>(`/benchmarks.json`, { auth: false });
    return { raw: data };
  }

  async submitOffer(input: OfferInput): Promise<Offer> {
    const payload: Record<string, unknown> = {
      agentName: input.agentName,
      operator: input.agentOperator,
      agentEndpoint: input.agentEndpoint,
      agentWallet: input.agentWallet,
      audience: input.audience ?? "targeted",
      creatorCode: input.creatorCode,
      boardEligibility: input.boardEligibility,
      platform: input.deliverable.platform,
      kind: input.deliverable.kind,
      caption: input.deliverable.caption,
      mediaUrl: input.deliverable.mediaUrl,
      linkUrl: input.deliverable.linkUrl,
      priceCents: input.priceCents,
      currency: input.currency,
      testMode: input.testMode,
      sandbox: input.sandbox,
      sandboxChain: input.sandboxChain,
      sandboxOutcome: input.sandboxOutcome,
    };
    for (const key of Object.keys(payload)) {
      if (payload[key] === undefined) delete payload[key];
    }

    const data = await this.request<{ offerId?: string; offer_id?: string; id?: string }>(
      `/offer`,
      { method: "POST", body: payload },
    );
    const offerId = data.offerId ?? data.offer_id ?? data.id;
    if (!offerId) {
      throw new RoosterApiError(
        "Rooster submitOffer response did not include an offer id.",
        undefined,
        data,
      );
    }
    return { offerId, raw: data };
  }

  /**
   * Cancels an offer that hasn't been funded yet (added by Rooster 2026-08-26).
   * Only valid up to and including `awaiting_funding` — Rooster returns 409
   * once escrow is funded, by design, since a funded offer belongs to the
   * creator too. Not called by any automated path in this codebase; this is
   * an operator-invoked cleanup action.
   */
  async cancelOffer(offerId: string): Promise<void> {
    await this.request<unknown>(`/offer/${encodeURIComponent(offerId)}/cancel`, { method: "POST" });
  }

  async getOfferStatus(offerId: string): Promise<OfferStatus> {
    const envelope = await this.request<Record<string, unknown>>(
      `/offer-status/${encodeURIComponent(offerId)}`,
    );
    // Real Rooster responses nest the offer under an "offer" key
    // (confirmed live 2026-08-24); fall back to a flat shape defensively in
    // case that changes.
    const data = (envelope.offer as Record<string, unknown> | undefined) ?? envelope;

    const fundingRaw = data.funding as Record<string, unknown> | null | undefined;
    const state = normalizeState(data.escrowStatus ?? data.status ?? data.state);
    const lifecycle = normalizeLifecycle(data.lifecycle);
    // `terminal` is Rooster's own authoritative flag (fixed server-side
    // 2026-08-25) — trust it when present. Fall back to the old state-based
    // guess only for responses that predate the fix (e.g. recorded test
    // fixtures), so older callers/tests don't need to change.
    const terminal = typeof data.terminal === "boolean" ? data.terminal : TERMINAL_OFFER_STATES.has(state);

    return {
      offerId,
      // escrowStatus is the authoritative money-lifecycle field once an offer is
      // accepted -- confirmed live 2026-08-24: after a sandbox release, escrowStatus
      // reads "released" (releaseTx/releasedAt populated) while status stays stuck at
      // "posted" indefinitely. status is a fallback for pre-acceptance states (e.g.
      // testMode's posted_simulated) where escrowStatus is absent. Superseded by
      // `lifecycle`/`terminal` above for polling decisions, kept for callers that
      // already depend on `state`.
      state,
      lifecycle,
      terminal,
      funding: fundingRaw ? parseFunding(fundingRaw) : undefined,
      counterPriceCents: (data.counterPriceCents ?? data.counterPrice) as number | undefined,
      releaseTxHash: (data.releaseTx ?? data.releaseTxHash) as string | undefined,
      refundTxHash: (data.refundTx ?? data.refundTxHash) as string | undefined,
      // Only meaningful on delivered_awaiting_creator_wallet — passthrough only,
      // never invented. An explicit null in the payload must resolve to
      // undefined, not the literal string "null".
      autoRefundAt: (typeof (data.auto_refund_at ?? data.autoRefundAt) === "string"
        ? (data.auto_refund_at ?? data.autoRefundAt)
        : undefined) as string | undefined,
      raw: envelope,
    };
  }
}
