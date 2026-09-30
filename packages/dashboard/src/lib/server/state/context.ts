import type { SupabaseClient } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type PostgresStateContext = {
  supabase: SupabaseClient;
  accountId: string;
  orgId: string;
};

export class StateAccessError extends Error {
  constructor(public readonly response: Response) {
    super("state access denied");
  }
}

export function unauthorizedStateResponse(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export function missingAccountResponse(): Response {
  return Response.json({ error: "account not provisioned" }, { status: 403 });
}

export type PostgresContextResult =
  | { kind: "ok"; ctx: PostgresStateContext }
  | { kind: "anonymous" }
  | { kind: "unprovisioned" };

/**
 * Resolves the caller's org when hosted tenancy is enabled.
 *
 * "No session" and "a session whose account setup never finished" are kept apart: both used
 * to answer 401, and the client could not tell "sign in" from "your account is broken".
 */
export async function resolvePostgresContext(): Promise<PostgresContextResult | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return { kind: "anonymous" };

  const { data: identity, error: identityError } = await supabase
    .from("identities")
    .select("account_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (identityError) throw identityError;
  if (!identity?.account_id) return { kind: "unprovisioned" };

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("account_id", identity.account_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership?.org_id) return { kind: "unprovisioned" };

  return {
    kind: "ok",
    ctx: { supabase, accountId: identity.account_id, orgId: membership.org_id },
  };
}

export async function requirePostgresContext(): Promise<PostgresStateContext> {
  const result = await resolvePostgresContext();
  if (result?.kind === "ok") return result.ctx;
  if (result?.kind === "unprovisioned") throw new StateAccessError(missingAccountResponse());
  throw new StateAccessError(unauthorizedStateResponse());
}
