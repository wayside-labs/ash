import { createHash, randomBytes } from "node:crypto";
import type { AgentEvent } from "@ash/contract/alerts";
import { isLive, REVIEW_TTL_MS, type Review } from "./types";

export function newIngestToken(): string {
  return `art_${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Which review, if any, an event asks for. */
export function reviewKey(
  event: AgentEvent,
): { kind: Review["kind"]; intentId: string | null } | null {
  switch (event.kind) {
    case "payment_review_required":
      return { kind: "payment", intentId: event.review.intent_id };
    case "limit_increase_requested":
      return { kind: "limit_increase", intentId: null };
    default:
      return null;
  }
}

/**
 * Whether a payment event should open a fresh review given the one already on file for its
 * intent. A live review of any status stands — re-asking must not turn a rejection back
 * into a pending request, nor reset an approval's clock. A lapsed one is replaced.
 */
export function shouldOpenReview(existing: Review | null, now = Date.now()): boolean {
  return existing === null || !isLive(existing, now);
}

export function reviewExpiry(now = Date.now()): string {
  return new Date(now + REVIEW_TTL_MS).toISOString();
}
