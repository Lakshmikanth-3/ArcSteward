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
  RoosterApiError,
  type Creator,
  type Currency,
  type MarketBenchmark,
  type Offer,
  type OfferInput,
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

  async getOfferStatus(offerId: string): Promise<OfferStatus> {
    const envelope = await this.request<Record<string, unknown>>(
      `/offer-status/${encodeURIComponent(offerId)}`,
    );
    // Real Rooster responses nest the offer under an "offer" key
    // (confirmed live 2026-08-24); fall back to a flat shape defensively in
    // case that changes.
    const data = (envelope.offer as Record<string, unknown> | undefined) ?? envelope;

    const fundingRaw = data.funding as Record<string, unknown> | null | undefined;
    return {
      offerId,
      state: normalizeState(data.status ?? data.state),
      funding: fundingRaw
        ? {
            depositAddress: String(fundingRaw.depositAddress ?? fundingRaw.address ?? ""),
            amountCents: Number(fundingRaw.amountCents ?? fundingRaw.amount_cents ?? 0),
            currency: ((fundingRaw.currency as Currency | undefined) ?? "USDC") as Currency,
            deadline: fundingRaw.deadline as string | undefined,
          }
        : undefined,
      counterPriceCents: (data.counterPriceCents ?? data.counterPrice) as number | undefined,
      releaseTxHash: (data.releaseTx ?? data.releaseTxHash) as string | undefined,
      refundTxHash: (data.refundTx ?? data.refundTxHash) as string | undefined,
      raw: envelope,
    };
  }
}
