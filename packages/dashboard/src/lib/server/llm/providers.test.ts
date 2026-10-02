import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getSessionUser = vi.fn();
const isSupabaseConfigured = vi.fn();

vi.mock("@/lib/server/auth/session", () => ({ getSessionUser }));
vi.mock("@/lib/supabase/env", () => ({ isSupabaseConfigured }));
vi.mock("@/lib/server/i18n", () => ({ getDashboardLocale: async () => "en" }));
const apiKeys: { provider: string; secret: string }[] = [];
vi.mock("@/lib/server/store", () => ({
  readState: async () => ({ apiKeys }),
  StateAccessError: class extends Error {},
}));
// The probe always finds a CLI, whatever the machine running the suite has: hosted
// resolution must refuse it on policy, not because it happened to be missing.
vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (e: Error | null, out?: { stdout: string }) => void,
  ) => cb(null, { stdout: "9.9.9" }),
}));

const { anthropicApiKey, listProviders, openrouterPlatformAccess, resolveProvider } = await import(
  "./providers"
);

beforeEach(() => {
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
  isSupabaseConfigured.mockReturnValue(true);
  getSessionUser.mockResolvedValue(null);
  apiKeys.length = 0;
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
    apiKeys.push({ provider: "Anthropic", secret: "sk-ant-tenant" });
    getSessionUser.mockResolvedValue({ id: "u", email: null });
    expect((await resolveProvider(undefined)).provider).toBe("anthropic-api");
  });

  it("never runs the operator's Claude CLI hosted, even when it is installed and asked for", async () => {
    getSessionUser.mockResolvedValue({ id: "u", email: null });
    expect((await resolveProvider("claude-cli:sonnet")).provider).toBe("openrouter-platform");
    const cli = (await listProviders("en")).find((p) => p.id === "claude-cli");
    expect(cli?.available).toBe(false);
  });

  it("falls to demo hosted when only the CLI exists: no signed-in platform key, no free ride", async () => {
    expect(await resolveProvider("claude-cli:opus")).toEqual({ provider: "demo", model: "demo" });
  });

  it("keeps the CLI first in local JSON mode, where the operator is the user", async () => {
    isSupabaseConfigured.mockReturnValue(false);
    expect((await resolveProvider(undefined)).provider).toBe("claude-cli");
  });
});

describe("anthropicApiKey", () => {
  it("ignores the server's ANTHROPIC_API_KEY hosted: it is unmetered operator money", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-operator");
    expect(await anthropicApiKey()).toBeUndefined();
  });

  it("still returns a key the tenant stored themselves", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-operator");
    apiKeys.push({ provider: "anthropic", secret: "sk-ant-tenant" });
    expect(await anthropicApiKey()).toBe("sk-ant-tenant");
  });

  it("reads the env var in local JSON mode", async () => {
    isSupabaseConfigured.mockReturnValue(false);
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-local");
    expect(await anthropicApiKey()).toBe("sk-ant-local");
  });
});
