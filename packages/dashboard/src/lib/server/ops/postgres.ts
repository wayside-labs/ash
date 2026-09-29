import type { AgentEvent } from "@agent-rails/contract/alerts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { hashToken, newIngestToken, reviewExpiry, reviewKey, shouldOpenReview } from "./logic";
import {
  EVENTS_PAGE,
  isLive,
  type OpsScope,
  type OpsStore,
  type Review,
  type ReviewStatus,
  type StoredEvent,
  tokenHint,
} from "./types";

type ReviewRow = {
  id: string;
  workflow_id: string;
  kind: Review["kind"];
  intent_id: string | null;
  status: ReviewStatus;
  event: AgentEvent;
  created_at: string;
  decided_at: string | null;
  decided_by: string | null;
  expires_at: string;
};

const fromReviewRow = (row: ReviewRow): Review => ({
  id: row.id,
  workflowId: row.workflow_id,
  kind: row.kind,
  intentId: row.intent_id,
  status: row.status,
  event: row.event,
  createdAt: row.created_at,
  decidedAt: row.decided_at,
  decidedBy: row.decided_by,
  expiresAt: row.expires_at,
});

function orgOf(scope: OpsScope): { orgId: string; accountId: string } {
  if (scope.kind !== "org") throw new Error("postgres ops store needs an org scope");
  return scope;
}

/**
 * User-side calls run under the caller's session, so RLS is the floor exactly as for the
 * rest of the tenant's data. Service-side calls (the ingest route) have no session and use
 * the service role — which is why each of them filters by the org the token resolved to.
 */
const user = (): Promise<SupabaseClient> => createClient();
const service = (): SupabaseClient => createAdminClient();

function check<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw result.error;
  return result.data;
}

export const postgresOpsStore: OpsStore = {
  async issueToken(scope, workflowId) {
    const { orgId } = orgOf(scope);
    const db = await user();
    check(
      await db
        .from("ingest_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("workflow_id", workflowId)
        .is("revoked_at", null),
    );
    const token = newIngestToken();
    const row = check(
      await db
        .from("ingest_tokens")
        .insert({ org_id: orgId, workflow_id: workflowId, token, token_hash: hashToken(token) })
        .select("id")
        .single(),
    ) as { id: string };
    return { id: row.id, token };
  },

  async listTokens(scope, workflowId) {
    const { orgId } = orgOf(scope);
    let query = (await user())
      .from("ingest_tokens")
      .select("id, workflow_id, token, created_at, revoked_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false });
    if (workflowId) query = query.eq("workflow_id", workflowId);
    const rows = check(await query) as {
      id: string;
      workflow_id: string;
      token: string;
      created_at: string;
      revoked_at: string | null;
    }[];
    return rows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      createdAt: row.created_at,
      revokedAt: row.revoked_at,
      hint: tokenHint(row.token),
    }));
  },

  async activeToken(scope, workflowId) {
    const { orgId } = orgOf(scope);
    const row = check(
      await (await user())
        .from("ingest_tokens")
        .select("token")
        .eq("org_id", orgId)
        .eq("workflow_id", workflowId)
        .is("revoked_at", null)
        .maybeSingle(),
    ) as { token: string } | null;
    return row?.token ?? null;
  },

  async revokeToken(scope, id) {
    const { orgId } = orgOf(scope);
    const rows = check(
      await (await user())
        .from("ingest_tokens")
        .update({ revoked_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("id", id)
        .is("revoked_at", null)
        .select("id"),
    ) as { id: string }[];
    return rows.length > 0;
  },

  async resolveToken(token) {
    const row = check(
      await service()
        .from("ingest_tokens")
        .select("org_id, workflow_id")
        .eq("token_hash", hashToken(token))
        .is("revoked_at", null)
        .maybeSingle(),
    ) as { org_id: string; workflow_id: string } | null;
    if (!row) return null;
    // No account acts on the service side; the field exists for user-side scopes.
    return {
      scope: { kind: "org", orgId: row.org_id, accountId: "" },
      workflowId: row.workflow_id,
    };
  },

  async recordEvent(scope, workflowId, event) {
    const { orgId } = orgOf(scope);
    const db = service();
    const stored = check(
      await db
        .from("agent_events")
        .insert({ org_id: orgId, workflow_id: workflowId, kind: event.kind, event })
        .select("id")
        .single(),
    ) as { id: string };

    const key = reviewKey(event);
    if (!key) return { eventId: stored.id, review: null };

    let existing: Review | null = null;
    if (key.intentId) {
      const row = check(
        await db
          .from("reviews")
          .select("*")
          .eq("org_id", orgId)
          .eq("workflow_id", workflowId)
          .eq("intent_id", key.intentId)
          .maybeSingle(),
      ) as ReviewRow | null;
      existing = row ? fromReviewRow(row) : null;
    }
    const now = Date.now();
    if (!shouldOpenReview(existing, now)) return { eventId: stored.id, review: existing };

    const fields = {
      org_id: orgId,
      workflow_id: workflowId,
      kind: key.kind,
      intent_id: key.intentId,
      status: "pending",
      event,
      created_at: new Date(now).toISOString(),
      decided_at: null,
      decided_by: null,
      expires_at: reviewExpiry(now),
    };
    const row = check(
      existing
        ? await db.from("reviews").update(fields).eq("id", existing.id).select("*").single()
        : await db.from("reviews").insert(fields).select("*").single(),
    ) as ReviewRow;
    return { eventId: stored.id, review: fromReviewRow(row) };
  },

  async reviewForIntent(scope, workflowId, intentId) {
    const { orgId } = orgOf(scope);
    const row = check(
      await service()
        .from("reviews")
        .select("*")
        .eq("org_id", orgId)
        .eq("workflow_id", workflowId)
        .eq("intent_id", intentId)
        .maybeSingle(),
    ) as ReviewRow | null;
    const review = row ? fromReviewRow(row) : null;
    return review && isLive(review) ? review : null;
  },

  async listEvents(scope, limit = EVENTS_PAGE) {
    const { orgId } = orgOf(scope);
    const rows = check(
      await (await user())
        .from("agent_events")
        .select("id, workflow_id, kind, event, received_at")
        .eq("org_id", orgId)
        .order("received_at", { ascending: false })
        .limit(limit),
    ) as {
      id: string;
      workflow_id: string;
      kind: StoredEvent["kind"];
      event: AgentEvent;
      received_at: string;
    }[];
    return rows.map((row) => ({
      id: row.id,
      workflowId: row.workflow_id,
      kind: row.kind,
      event: row.event,
      receivedAt: row.received_at,
    }));
  },

  async listReviews(scope, status) {
    const { orgId } = orgOf(scope);
    let query = (await user())
      .from("reviews")
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(EVENTS_PAGE);
    if (status) query = query.eq("status", status);
    return (check(await query) as ReviewRow[]).map(fromReviewRow);
  },

  async decideReview(scope, id, decision, decidedBy) {
    const { orgId } = orgOf(scope);
    const now = Date.now();
    // RLS only lets a member update a pending row; the expiry check is ours.
    const rows = check(
      await (await user())
        .from("reviews")
        .update({
          status: decision,
          decided_at: new Date(now).toISOString(),
          decided_by: decidedBy || null,
          expires_at: reviewExpiry(now),
        })
        .eq("org_id", orgId)
        .eq("id", id)
        .eq("status", "pending")
        .gt("expires_at", new Date(now).toISOString())
        .select("*"),
    ) as ReviewRow[];
    return rows[0] ? fromReviewRow(rows[0]) : null;
  },
};
