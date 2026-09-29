import type { AgentEvent } from "@agent-rails/contract/alerts";

/**
 * Operational records that arrive from agent-side processes, not from the operator:
 * ingest tokens, the events posted with them, and the review queue those events feed.
 *
 * Kept apart from `DashboardState` on purpose. The state is rewritten whole on every
 * mutation and read whole on every page; events only ever grow, and arrive from a caller
 * with no user session at all.
 */

export type IngestToken = {
  id: string;
  workflowId: string;
  /** sha256 hex of the token: what an incoming bearer is looked up by. */
  tokenHash: string;
  /**
   * The token itself, same secret class as an MCP env value: never returned by a read
   * route, only compiled into the runner export so the agent's MCP can present it.
   */
  token: string;
  createdAt: string;
  revokedAt: string | null;
};

/** What a read route may show: the token reduced to a recognisable tail. */
export type IngestTokenView = Omit<IngestToken, "token" | "tokenHash"> & { hint: string };

export type StoredEvent = {
  id: string;
  workflowId: string;
  kind: AgentEvent["kind"];
  event: AgentEvent;
  receivedAt: string;
};

export type ReviewStatus = "pending" | "approved" | "rejected";

export type Review = {
  id: string;
  workflowId: string;
  kind: "payment" | "limit_increase";
  /** Payment reviews only: the approval is bound to this and to nothing looser. */
  intentId: string | null;
  status: ReviewStatus;
  event: AgentEvent;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  /**
   * A pending review lapses so a stale request does not wait forever; an approval lapses
   * so it cannot be spent days later against a changed situation. Either way the agent's
   * next attempt queues a fresh review.
   */
  expiresAt: string;
};

/** Who a user-side call acts for; the JSON store has exactly one tenant. */
export type OpsScope = { kind: "json" } | { kind: "org"; orgId: string; accountId: string };

export const REVIEW_TTL_MS = 24 * 60 * 60 * 1000;
export const EVENTS_PAGE = 100;
/** Retention for the JSON store, which has no background job to trim it. */
export const MAX_JSON_EVENTS = 2_000;

export interface OpsStore {
  issueToken(scope: OpsScope, workflowId: string): Promise<{ id: string; token: string }>;
  listTokens(scope: OpsScope, workflowId?: string): Promise<IngestTokenView[]>;
  /** The live token for a workflow, whole — only for compiling the runner export. */
  activeToken(scope: OpsScope, workflowId: string): Promise<string | null>;
  revokeToken(scope: OpsScope, id: string): Promise<boolean>;

  /** Service side: which tenant and workflow a bearer belongs to. */
  resolveToken(token: string): Promise<{ scope: OpsScope; workflowId: string } | null>;
  /** Service side. Also opens or refreshes the review a reviewable event asks for. */
  recordEvent(
    scope: OpsScope,
    workflowId: string,
    event: AgentEvent,
  ): Promise<{ eventId: string; review: Review | null }>;
  /** Service side: the live decision on one payment, or null (none, or lapsed). */
  reviewForIntent(scope: OpsScope, workflowId: string, intentId: string): Promise<Review | null>;

  listEvents(scope: OpsScope, limit?: number): Promise<StoredEvent[]>;
  listReviews(scope: OpsScope, status?: ReviewStatus): Promise<Review[]>;
  decideReview(
    scope: OpsScope,
    id: string,
    decision: "approved" | "rejected",
    decidedBy: string,
  ): Promise<Review | null>;
}

export function tokenHint(token: string): string {
  return `…${token.slice(-4)}`;
}

export function isLive(review: Review, now = Date.now()): boolean {
  return Date.parse(review.expiresAt) > now;
}
