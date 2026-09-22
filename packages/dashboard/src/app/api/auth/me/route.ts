import { toSessionUser } from "@/lib/server/auth/session";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Proves the caller's JWT reaches Postgres under RLS: account and profile rows
 * are readable only when auth.uid() maps to the same account_id.
 */
export async function GET() {
  if (!isSupabaseConfigured()) {
    return Response.json({ configured: false, user: null, account: null });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return Response.json({ configured: true, user: null, account: null });
  }

  const { data: identity, error: identityError } = await supabase
    .from("identities")
    .select("account_id, provider, subject")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (identityError) {
    return Response.json({ error: identityError.message }, { status: 500 });
  }

  const { data: account, error: accountError } = identity?.account_id
    ? await supabase
        .from("accounts")
        .select("id, created_at")
        .eq("id", identity.account_id)
        .maybeSingle()
    : { data: null, error: null };

  if (accountError) {
    return Response.json({ error: accountError.message }, { status: 500 });
  }

  const { data: profile, error: profileError } = identity?.account_id
    ? await supabase
        .from("profiles")
        .select("display_name, email")
        .eq("account_id", identity.account_id)
        .maybeSingle()
    : { data: null, error: null };

  if (profileError) {
    return Response.json({ error: profileError.message }, { status: 500 });
  }

  const { data: memberships, error: membershipsError } = await supabase
    .from("memberships")
    .select("org_id, role, organizations(name)")
    .eq("account_id", identity?.account_id ?? "");

  if (membershipsError) {
    return Response.json({ error: membershipsError.message }, { status: 500 });
  }

  return Response.json({
    configured: true,
    user: toSessionUser(user),
    identity,
    account,
    profile,
    memberships,
  });
}
