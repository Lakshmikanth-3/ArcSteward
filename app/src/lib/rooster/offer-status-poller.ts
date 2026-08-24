/**
 * lib/rooster/offer-status-poller.ts
 * Bounded polling for Rooster offer status — Rooster provides no
 * webhooks/callbacks for this integration, so polling is the only way to
 * observe state changes.
 */
import { TERMINAL_OFFER_STATES, type OfferStatus } from "./types";
import type { RoosterClient } from "./rooster-client";
import { roosterLogger } from "./logger";

export interface WaitForOfferStatusOptions {
  timeoutMs?: number;
  intervalMs?: number;
  client: RoosterClient;
  /** Injectable for tests — defaults to a real setTimeout-based sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface PollResult {
  status: OfferStatus;
  timedOut: boolean;
  attempts: number;
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const DEFAULT_INTERVAL_MS = 5_000;
const MAX_BACKOFF_MS = 60_000;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForOfferStatus(
  offerId: string,
  opts: WaitForOfferStatusOptions,
): Promise<PollResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const baseIntervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const now = opts.now ?? Date.now;

  const start = now();
  let attempts = 0;
  let lastStatus: OfferStatus | undefined;
  let currentInterval = baseIntervalMs;

  while (now() - start < timeoutMs) {
    attempts++;
    try {
      lastStatus = await opts.client.getOfferStatus(offerId);
      currentInterval = baseIntervalMs; // reset backoff after a healthy call
      roosterLogger.info("Polled Rooster offer status", {
        offerId,
        state: lastStatus.state,
        attempts,
      });
      if (TERMINAL_OFFER_STATES.has(lastStatus.state)) {
        return { status: lastStatus, timedOut: false, attempts };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      roosterLogger.warn("Rooster offer status poll failed — backing off", {
        offerId,
        attempts,
        result: message,
      });
      // Back off further on repeated errors (e.g. rate limiting), bounded.
      currentInterval = Math.min(currentInterval * 2, MAX_BACKOFF_MS);
    }

    const remaining = timeoutMs - (now() - start);
    if (remaining <= 0) break;
    await sleep(Math.min(currentInterval, remaining));
  }

  if (!lastStatus) {
    // Never got a single successful response — synthesize an "unknown"
    // status rather than throw, so callers can inspect timedOut and decide.
    lastStatus = { offerId, state: "unknown", raw: null };
  }
  roosterLogger.warn("waitForOfferStatus timed out", {
    offerId,
    attempts,
    state: lastStatus.state,
  });
  return { status: lastStatus, timedOut: true, attempts };
}
