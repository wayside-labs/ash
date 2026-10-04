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
// probe must not see it unless a test asks, or the CLI would shape every
// resolution below.
const cli = vi.hoisted(() => ({ installed: false, probes: 0 }));
vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    done: (e: Error | null, out?: { stdout: string }) => void,
  ) => {
    cli.probes += 1;
    return cli.installed
      ? done(null, { stdout: "2.1.289 (Claude Code)\n" })
      : done(new Error("not found"));
  },
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
  cli.installed = false;
  cli.probes = 0;
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
      model: "openrouter:anthropic/claude-haiku-4.5",
    });
  });

  it("prefers a key the user brought over the platform key in local mode", async () => {
    isSupabaseConfigured.mockReturnValue(false);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    expect((await resolveProvider(undefined)).provider).toBe("anthropic-api");
  });

  // The probe caches for a minute, so a CLI that "runs" needs a fresh module.
  it("ranks the platform key above a CLI that runs, and callers can opt out of it", async () => {
    // Local mode: the CLI is only ever a development provider.
    isSupabaseConfigured.mockReturnValue(false);
    cli.installed = true;
    vi.resetModules();
    const fresh = await import("./providers");

    expect(await fresh.resolveProvider(undefined)).toEqual({
      provider: "openrouter-platform",
      model: "openrouter:anthropic/claude-haiku-4.5",
    });
    expect(await fresh.resolveProvider(undefined, { platform: false })).toEqual({
      provider: "claude-cli",
      model: "claude-cli:sonnet",
    });
    // An explicit platform model is refused too when the caller opted out.
    expect(
      (await fresh.resolveProvider("openrouter:anthropic/claude-haiku-4.5", { platform: false }))
        .provider,
    ).toBe("claude-cli");
  });

  // ADR-019 / ADR-026: a hosted install chats on the platform key only. Not the host's CLI
  // login (even a working one), not a stored or env Anthropic key — and a browser that still
  // remembers either model falls through to the platform default.
  it("lists, probes and resolves only the platform key on a hosted install", async () => {
    cli.installed = true;
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.resetModules();
    const fresh = await import("./providers");
    getSessionUser.mockResolvedValue({ id: "u", email: null });

    const providers = await fresh.listProviders("en");
    expect(providers.map((p) => p.id)).toEqual(["openrouter-platform", "demo"]);
    expect(cli.probes).toBe(0);

    const platformDefault = {
      provider: "openrouter-platform",
      model: "openrouter:anthropic/claude-haiku-4.5",
    };
    expect(await fresh.resolveProvider(undefined)).toEqual(platformDefault);
    expect(await fresh.resolveProvider("claude-cli:sonnet")).toEqual(platformDefault);
    expect(await fresh.resolveProvider("claude-sonnet-5")).toEqual(platformDefault);

    // A caller that cannot use the platform key gets demo, never a leftover local provider.
    for (const stale of ["claude-cli:sonnet", "claude-sonnet-5"]) {
      expect(await fresh.resolveProvider(stale, { platform: false })).toEqual({
        provider: "demo",
        model: "demo",
      });
    }
  });
});
