import { isSupabaseConfigured } from "@/lib/supabase/env";
import { requirePostgresContext } from "../state/context";
import { jsonOpsStore } from "./json";
import { postgresOpsStore } from "./postgres";
import type { OpsScope, OpsStore } from "./types";

export * from "./types";

export function opsStore(): OpsStore {
  return isSupabaseConfigured() ? postgresOpsStore : jsonOpsStore;
}

/** The signed-in operator's scope. Throws `StateAccessError` (401) like the state routes. */
export async function userOpsScope(): Promise<OpsScope> {
  if (!isSupabaseConfigured()) return { kind: "json" };
  const ctx = await requirePostgresContext();
  return { kind: "org", orgId: ctx.orgId, accountId: ctx.accountId };
}

/** Who decided, for the audit trail: the account, or "local" on the single-tenant store. */
export function actorOf(scope: OpsScope): string {
  return scope.kind === "org" ? scope.accountId : "";
}

/**
 * The machine-to-machine door: a workflow's ingest token as a bearer. This is the one
 * family of routes that does not call `assertSameOrigin` — the caller is an MCP server,
 * not a browser, and carries no cookie a cross-site page could ride
 * (`route-guard.test.ts` lists these routes and requires this call instead).
 */
export async function authenticateIngest(
  req: Request,
): Promise<{ scope: OpsScope; workflowId: string; token: string } | Response> {
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) return Response.json({ error: "bearer token required" }, { status: 401 });
  const resolved = await opsStore().resolveToken(token);
  if (!resolved) return Response.json({ error: "unknown or revoked token" }, { status: 401 });
  return { ...resolved, token };
}

/**
 * Where agents reach this dashboard. Behind a proxy the request's own origin can be the
 * loopback listener, so a deployment states its public URL in `DASHBOARD_PUBLIC_URL`.
 */
export function ingestBaseUrl(req: Request): string {
  const declared = process.env.DASHBOARD_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return `${declared || new URL(req.url).origin}/api/ingest`;
}

/** The workflow's live token, issued on first use so an exported agent always reports. */
export async function ensureIngestToken(scope: OpsScope, workflowId: string): Promise<string> {
  const store = opsStore();
  return (
    (await store.activeToken(scope, workflowId)) ??
    (await store.issueToken(scope, workflowId)).token
  );
}
