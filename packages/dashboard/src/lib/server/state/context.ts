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

/** Resolves the caller's org when hosted tenancy is enabled. */
export async function resolvePostgresContext(): Promise<PostgresStateContext | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) return null;

  const { data: identity, error: identityError } = await supabase
    .from("identities")
    .select("account_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();
  if (identityError || !identity?.account_id) return null;

  const { data: membership, error: membershipError } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("account_id", identity.account_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membershipError || !membership?.org_id) return null;

  return {
    supabase,
    accountId: identity.account_id,
    orgId: membership.org_id,
  };
}

export async function requirePostgresContext(): Promise<PostgresStateContext> {
  const ctx = await resolvePostgresContext();
  if (!ctx) {
    throw new StateAccessError(unauthorizedStateResponse());
  }
  return ctx;
}
