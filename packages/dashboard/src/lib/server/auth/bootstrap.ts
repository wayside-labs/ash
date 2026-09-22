import type { User } from "@supabase/supabase-js";
import { seedPostgresOrg } from "@/lib/server/state/seed-postgres";
import { createAdminClient } from "@/lib/supabase/admin";

function googleSubject(user: User): string {
  const identity = user.identities?.find((row) => row.provider === "google");
  const sub = identity?.identity_data?.sub;
  if (typeof sub === "string" && sub.length > 0) return sub;
  return user.id;
}

/**
 * First Google sign-in: mint account → identity → org → membership → profile/settings.
 * Runs under the service role because RLS deliberately blocks user-session inserts
 * on those tables (ADR-017, tenancy.sql bootstrap comment).
 */
export async function ensureAccountForUser(user: User): Promise<string> {
  const admin = createAdminClient();

  const { data: existing, error: lookupError } = await admin
    .from("identities")
    .select("account_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  if (lookupError) throw lookupError;
  if (existing?.account_id) {
    await ensureOrgSeeded(admin, existing.account_id);
    return existing.account_id;
  }

  const { data: account, error: accountError } = await admin
    .from("accounts")
    .insert({})
    .select("id")
    .single();
  if (accountError) throw accountError;

  const { error: identityError } = await admin.from("identities").insert({
    account_id: account.id,
    auth_user_id: user.id,
    provider: "google",
    subject: googleSubject(user),
  });
  if (identityError) throw identityError;

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .insert({ name: "My workspace" })
    .select("id")
    .single();
  if (orgError) throw orgError;

  const { error: membershipError } = await admin.from("memberships").insert({
    account_id: account.id,
    org_id: org.id,
    role: "owner",
  });
  if (membershipError) throw membershipError;

  const displayName = user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User";

  const { error: profileError } = await admin.from("profiles").insert({
    account_id: account.id,
    display_name: displayName,
    email: user.email ?? "",
  });
  if (profileError) throw profileError;

  const { error: settingsError } = await admin.from("settings").insert({
    account_id: account.id,
  });
  if (settingsError) throw settingsError;

  await seedPostgresOrg(admin, org.id);

  return account.id;
}

async function ensureOrgSeeded(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string,
): Promise<void> {
  const { data: membership, error: membershipError } = await admin
    .from("memberships")
    .select("org_id")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (membershipError || !membership?.org_id) return;

  const { count, error: countError } = await admin
    .from("workflows")
    .select("id", { count: "exact", head: true })
    .eq("org_id", membership.org_id);
  if (countError) throw countError;
  if ((count ?? 0) === 0) {
    await seedPostgresOrg(admin, membership.org_id);
  }
}
