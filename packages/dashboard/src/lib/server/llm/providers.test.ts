import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const isSupabaseConfigured = vi.fn();

vi.mock("@/lib/server/auth/session", () => ({ getSessionUser }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured }));
vi.mock("@/lib/server/i18n", () => ({ getDashboardLocale: async () => "en" }));
vi.mock("@/lib/server/store", () => ({
  readState: async () => ({ apiKeys: [] }),
  StateAccessError: class extends Error {},
}));
// The developer running the suite may well have Claude Code installed; the
// probe must not see it, or the CLI wins every resolution below.
vi.mock("node:child_process", () => ({
  execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (e: Error) => void) =>
    cb(new Error("not found")),
}));

const { openrouterPlatformAccess, resolveProvider } = await import("./providers");

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
  isSupabaseConfigured.mockReturnValue(true);
  getSessionUser.mockResolvedValue(null);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("openrouterPlatformAccess", () => {
  it("is unconfigured without the env key", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(await openrouterPlatformAccess()).toEqual({ granted: false, reason: "unconfigured" });
  });

  it("refuses a hosted caller with no session", async () => {
    expect(await openrouterPlatformAccess()).toEqual({ granted: false, reason: "signed-out" });
  });

  it("grants a signed-in caller and never sends the raw auth id", async () => {
    getSessionUser.mockResolvedValue({ id: "auth-uuid-1", email: null });
    const access = await openrouterPlatformAccess();
    expect(access).toMatchObject({ granted: true, apiKey: "sk-or-test" });
    const user = access.granted ? access.user : undefined;
    expect(user).toMatch(/^[0-9a-f]{32}$/);
    expect(user).not.toContain("auth-uuid-1");
  });

  it("grants local JSON mode on the env key alone", async () => {
    isSupabaseConfigured.mockReturnValue(false);
    expect(await openrouterPlatformAccess()).toEqual({ granted: true, apiKey: "sk-or-test" });
  });
});

describe("resolveProvider", () => {
  it("falls to demo for a signed-out hosted caller even when asked for a platform model", async () => {
    expect(await resolveProvider("openrouter:anthropic/claude-sonnet-5.5")).toEqual({
      provider: "demo",
      model: "demo",
    });
  });

  it("uses the platform key for a signed-in caller", async () => {
    getSessionUser.mockResolvedValue({ id: "u", email: null });
    expect(await resolveProvider(undefined)).toEqual({
      provider: "openrouter-platform",
      model: "openrouter:anthropic/claude-sonnet-5.5",
    });
  });

  it("prefers a key the user brought over the platform key", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    getSessionUser.mockResolvedValue({ id: "u", email: null });
    expect((await resolveProvider(undefined)).provider).toBe("anthropic-api");
  });
});
