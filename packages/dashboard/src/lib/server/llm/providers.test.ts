import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let apiKeys: { id: string; provider: string; secret: string; createdAt: string }[] = [];
const cliRuns = vi.fn();

vi.mock("@/lib/server/store", async () => {
  const { StateAccessError } = await import("@/lib/server/state/context");
  return { readState: async () => ({ apiKeys }), StateAccessError };
});
vi.mock("@/lib/server/i18n", () => ({ getDashboardLocale: async () => "en" }));
vi.mock("node:child_process", () => ({
  execFile: (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (e: Error | null, out?: { stdout: string }) => void,
  ) => {
    cliRuns();
    cb(null, { stdout: "2.1.284 (Claude Code)" });
  },
}));
vi.mock("./model-catalog", () => ({
  listAnthropicModels: async () => ({
    kind: "ok",
    models: [{ id: "claude-sonnet-5", label: "Sonnet 5" }],
  }),
  listOpenAiModels: async (key: string) =>
    key === "sk-bad"
      ? { kind: "rejected" }
      : {
          kind: "ok",
          models: [
            { id: "openai:gpt-4.1", label: "gpt-4.1" },
            { id: "openai:gpt-5", label: "gpt-5" },
          ],
        },
}));

const { listProviders, providerApiKey, resolveProvider } = await import("./providers");

const key = (provider: string, secret: string, createdAt = "2026-09-29T00:00:00Z") => ({
  id: `k_${provider}_${createdAt}`,
  provider,
  secret,
  createdAt,
});

function hostedMode(on: boolean) {
  if (on) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  }
}

describe("chat providers", () => {
  beforeEach(() => {
    apiKeys = [];
    cliRuns.mockReset();
  });

  afterEach(() => {
    hostedMode(false);
    delete process.env.OPENAI_API_KEY;
  });

  it("never offers the server's Claude Code on the hosted console", async () => {
    hostedMode(true);
    const cli = (await listProviders("en")).find((p) => p.id === "claude-cli");
    expect(cli?.available).toBe(false);
    expect(cliRuns).not.toHaveBeenCalled();
  });

  it("uses the tenant's OpenAI key by default when hosted", async () => {
    hostedMode(true);
    apiKeys = [key("OpenAI", "sk-live")];
    expect(await resolveProvider(undefined)).toEqual({
      provider: "openai-api",
      model: "openai:gpt-5",
    });
  });

  it("honours an explicitly chosen model from the key's list", async () => {
    hostedMode(true);
    apiKeys = [key("OpenAI", "sk-live")];
    expect(await resolveProvider("openai:gpt-4.1")).toEqual({
      provider: "openai-api",
      model: "openai:gpt-4.1",
    });
  });

  it("shows a rejected key as unavailable and falls back to demo", async () => {
    hostedMode(true);
    apiKeys = [key("OpenAI", "sk-bad")];
    const openai = (await listProviders("en")).find((p) => p.id === "openai-api");
    expect(openai?.available).toBe(false);
    expect(openai?.detail).toMatch(/rejected/i);
    expect((await resolveProvider(undefined)).provider).toBe("demo");
  });

  it("ignores the operator's env key when hosted, but not locally", async () => {
    process.env.OPENAI_API_KEY = "sk-operator";
    hostedMode(true);
    expect(await providerApiKey("openai-api")).toBeUndefined();
    hostedMode(false);
    expect(await providerApiKey("openai-api")).toBe("sk-operator");
  });

  it("matches the provider name loosely and skips empty secrets", async () => {
    hostedMode(true);
    apiKeys = [
      key(" openai ", "sk-old", "2026-09-01T00:00:00Z"),
      key("OPENAI", "sk-new", "2026-09-29T00:00:00Z"),
      key("OpenAI", "  ", "2026-09-30T00:00:00Z"),
    ];
    expect(await providerApiKey("openai-api")).toBe("sk-new");
  });

  it("still prefers the local Claude Code outside hosted mode", async () => {
    apiKeys = [key("OpenAI", "sk-live")];
    expect(await resolveProvider(undefined)).toEqual({
      provider: "claude-cli",
      model: "claude-cli:sonnet",
    });
  });
});
