import { createClient } from "@supabase/supabase-js";
import { isSupabaseConfigured, requirePublicSupabaseEnv, supabaseServiceRoleKey } from "./env";

/** Service role — bootstrap and invitation flows only. Never import from client code. */
export function createAdminClient() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }
  const key = supabaseServiceRoleKey();
  if (!key) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is not configured");
  }
  const { url } = requirePublicSupabaseEnv();
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
