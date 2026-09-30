import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenRouterOptions } from "@/lib/server/llm/openrouter-api";

const resolveProvider = vi.fn();
const openrouterPlatformAccess = vi.fn();
const buildContext = vi.fn();
const streamOpenRouter = vi.fn();

vi.mock("@/lib/server/llm/providers", () => ({
  resolveProvider,
  openrouterPlatformAccess,
  anthropicApiKey: async () => undefined,
}));
vi.mock("@/lib/server/llm/context", () => ({ buildContext }));
vi.mock("@/lib/server/i18n", () => ({
  getDashboardLocale: async () => "en",
  serverT: async (key: string) => key,
}));
vi.mock("@/lib/server/llm/openrouter-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/llm/openrouter-api")>()),
  streamOpenRouter,
}));

const { POST } = await import("./route");
const { resetLimits } = await import("@/lib/server/rate-limit");

const HEADERS = {
  origin: "http://localhost:3000",
  host: "localhost:3000",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

function chat(messages: { role: "user" | "assistant"; content: string }[]) {
  return POST(
    new Request("http://localhost:3000/api/chat", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify({ messages }),
    }),
  );
}

const PLATFORM = {
  provider: "openrouter-platform",
  model: "openrouter:anthropic/claude-sonnet-5.5",
};

beforeEach(() => {
  resetLimits();
  vi.clearAllMocks();
  resolveProvider.mockResolvedValue(PLATFORM);
  buildContext.mockResolvedValue("SNAPSHOT");
  streamOpenRouter.mockImplementation(async function* () {
    yield "ok";
  });
});

describe("POST /api/chat on the platform key", () => {
  it("401s a caller without access before the snapshot is built", async () => {
    openrouterPlatformAccess.mockResolvedValue({ granted: false, reason: "signed-out" });
    const res = await chat([{ role: "user", content: "hi" }]);
    expect(res.status).toBe(401);
    expect(buildContext).not.toHaveBeenCalled();
    expect(streamOpenRouter).not.toHaveBeenCalled();
  });

  it("streams for a granted caller, tagged, with every user turn fenced", async () => {
    openrouterPlatformAccess.mockResolvedValue({ granted: true, apiKey: "k", user: "hashed" });
    const res = await chat([
      { role: "user", content: "first" },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second" },
    ]);
    expect(res.headers.get("x-agent-rails-mode")).toBe("openrouter-platform");
    expect(await res.text()).toBe("ok");

    const options = streamOpenRouter.mock.calls[0]?.[0] as OpenRouterOptions;
    expect(options.user).toBe("hashed");
    const users = options.messages.filter((m) => m.role === "user");
    expect(users.every((m) => m.content.includes('<user_message untrusted="true">'))).toBe(true);
  });

  it("caps one caller below the route-wide window", async () => {
    openrouterPlatformAccess.mockResolvedValue({ granted: true, apiKey: "k", user: "one" });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await chat([{ role: "user", content: "hi" }]);
      await res.text();
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);

    openrouterPlatformAccess.mockResolvedValue({ granted: true, apiKey: "k", user: "two" });
    expect((await chat([{ role: "user", content: "hi" }])).status).toBe(200);
  });

  it("shows a localized message, not the upstream one, when the stream fails", async () => {
    const { OpenRouterError } = await import("@/lib/server/llm/openrouter-api");
    openrouterPlatformAccess.mockResolvedValue({ granted: true, apiKey: "k" });
    streamOpenRouter.mockImplementation(async function* () {
      yield* [];
      throw new OpenRouterError("Insufficient credits on account acct_123", 402);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const text = await (await chat([{ role: "user", content: "hi" }])).text();
    expect(text).not.toContain("acct_123");
    expect(text).toContain("temporarily unavailable");
  });
});
