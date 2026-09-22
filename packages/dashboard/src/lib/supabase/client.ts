import { createBrowserClient } from "@supabase/ssr";
import { isSupabaseConfigured, requirePublicSupabaseEnv } from "./env";

export function createClient() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }
  const { url, anonKey } = requirePublicSupabaseEnv();
  return createBrowserClient(url, anonKey);
}
