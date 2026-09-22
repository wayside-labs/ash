import { afterEach, describe, expect, it } from "vitest";
import { isSupabaseConfigured, supabaseAnonKey, supabaseUrl } from "./env";

describe("supabase env", () => {
  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  });

  it("is not configured without public env vars", () => {
    expect(isSupabaseConfigured()).toBe(false);
  });

  it("accepts publishable or anon key names", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
    expect(isSupabaseConfigured()).toBe(true);
    expect(supabaseUrl()).toBe("https://example.supabase.co");
    expect(supabaseAnonKey()).toBe("anon-key");

    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
    expect(supabaseAnonKey()).toBe("publishable-key");
  });
});
