/**
 * lib/rooster/offer-validation.ts
 * Pure validation of offer input before it's ever sent to Rooster or gated
 * by RoosterCapability. No network calls, no side effects.
 */
import { RoosterValidationError, type OfferInput } from "./types";

const PLATFORMS = new Set(["instagram", "tiktok", "youtube", "facebook", "x", "linkedin"]);
const KINDS = new Set(["post", "reel", "story", "shoutout", "video"]);

/** Absolute floor Rooster enforces for any offer, test or real. */
const ABSOLUTE_MIN_CENTS = 500; // $5
/** Rooster's documented minimum for a real, escrow-funded offer. Not enforced in test mode. */
const REAL_OFFER_MIN_CENTS = 2500; // $25
/** Rooster's documented ceiling. */
const MAX_CENTS = 50_000_00; // $50,000

export function validateOfferInput(input: OfferInput): void {
  const issues: string[] = [];

  if (typeof input.testMode !== "boolean") {
    issues.push("testMode must be explicitly true or false.");
  }

  if (input.sandbox && input.testMode) {
    issues.push("sandbox and testMode are mutually exclusive.");
  }

  if (input.sandbox) {
    if (!input.agentWallet || input.agentWallet.trim().length === 0) {
      issues.push("agentWallet is required for a sandbox offer (refund destination).");
    }
    if (!input.sandboxChain) {
      issues.push("sandboxChain is required for a sandbox offer.");
    }
  } else {
    const audience = input.audience ?? "targeted";
    if (audience === "targeted") {
      if (!input.creatorCode || input.creatorCode.trim().length === 0) {
        issues.push('creatorCode is required when audience is "targeted".');
      }
    } else if (audience === "board") {
      if (input.creatorCode) {
        issues.push('creatorCode must be omitted when audience is "board".');
      }
    } else {
      issues.push(`audience must be "targeted" or "board", got "${String(audience)}".`);
    }
  }

  const d = input.deliverable;
  if (!d) {
    issues.push("deliverable is required.");
  } else {
    if (!PLATFORMS.has(d.platform)) {
      issues.push(`deliverable.platform "${String(d.platform)}" is not a valid platform.`);
    }
    if (!KINDS.has(d.kind)) {
      issues.push(`deliverable.kind "${String(d.kind)}" is not a valid deliverable kind.`);
    }
    if (!d.caption || d.caption.trim().length === 0) {
      issues.push("deliverable.caption is required.");
    } else if (!/#ad\b/i.test(d.caption)) {
      issues.push('deliverable.caption must contain "#ad" (FTC paid-partnership disclosure).');
    }
    if (d.platform === "instagram" && !d.mediaUrl) {
      issues.push("deliverable.mediaUrl is required for instagram offers.");
    }
    if (d.linkUrl && d.caption && d.caption.includes(d.linkUrl)) {
      issues.push("Links must go in deliverable.linkUrl, not embedded in the caption body.");
    }
  }

  if (input.currency !== "USDC") {
    issues.push(`currency must be "USDC" for Rooster funding on this rail, got "${String(input.currency)}".`);
  }

  if (!Number.isFinite(input.priceCents) || input.priceCents <= 0) {
    issues.push("priceCents must be a positive number.");
  } else {
    const minCents = input.testMode || input.sandbox ? ABSOLUTE_MIN_CENTS : REAL_OFFER_MIN_CENTS;
    if (input.priceCents < minCents) {
      issues.push(
        `priceCents ${input.priceCents} is below the ${minCents === ABSOLUTE_MIN_CENTS ? "test-mode/sandbox" : "real-offer"} ` +
          `minimum of ${minCents}c ($${(minCents / 100).toFixed(2)}).`,
      );
    }
    if (input.priceCents > MAX_CENTS) {
      issues.push(`priceCents ${input.priceCents} exceeds the maximum of ${MAX_CENTS}c.`);
    }
  }

  if (!input.agentName || input.agentName.trim().length === 0) {
    issues.push("agentName is required.");
  }

  if (issues.length > 0) {
    throw new RoosterValidationError("Offer input failed validation.", issues);
  }
}
