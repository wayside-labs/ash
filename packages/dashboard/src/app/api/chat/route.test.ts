import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenRouterOptions } from "@/lib/server/llm/openrouter-api";

const resolveProvider = vi.fn();
const openrouterPlatformAccess = vi.fn();
const buildContext = vi.fn();
const streamOpenRouter = vi.fn();
const billingConfig = vi.fn();
const resolveBillingScope = vi.fn();
const currentBalance = vi.fn();
const debitTurn = vi.fn();

vi.mock("@/lib/server/llm/providers", () => ({
  resolveProvider,
  openrouterPlatformAccess,
  anthropicApiKey: async () => undefined,
}));
vi.mock("@/lib/server/llm/context", () => ({ buildContext }));
vi.mock("@/lib/server/billing/meter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/server/billing/meter")>()),
  billingConfig,
  resolveBillingScope,
  currentBalance,
  debitTurn,
}));
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
  billingConfig.mockReturnValue({ enabled: false, markupBps: 2_000, starterMicros: 0 });
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
    expect(res.headers.get("x-ash-mode")).toBe("openrouter-platform");
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

describe("POST /api/chat with credit billing on", () => {
  const ORG = { kind: "org", orgId: "org-1", accountId: "acct-1" };

  beforeEach(() => {
    openrouterPlatformAccess.mockResolvedValue({ granted: true, apiKey: "k", user: "hashed" });
    billingConfig.mockReturnValue({ enabled: true, markupBps: 2_000, starterMicros: 0 });
    resolveBillingScope.mockResolvedValue(ORG);
    currentBalance.mockResolvedValue(5_000_000);
    debitTurn.mockResolvedValue(undefined);
  });

  it("402s an empty balance before the model is called", async () => {
    currentBalance.mockResolvedValue(0);
    const res = await chat([{ role: "user", content: "hi" }]);
    expect(res.status).toBe(402);
    const body = (await res.json()) as { code: string; error: string; requiredMicros: number };
    expect(body.code).toBe("insufficient_credit");
    expect(body.requiredMicros).toBeGreaterThan(0);
    expect(body.error).toContain("Not enough credit");
    expect(streamOpenRouter).not.toHaveBeenCalled();
  });

  it("402s a positive balance that cannot cover the worst case", async () => {
    currentBalance.mockResolvedValue(1_000);
    expect((await chat([{ role: "user", content: "hi" }])).status).toBe(402);
    expect(streamOpenRouter).not.toHaveBeenCalled();
  });

  it("401s when the session has no org to bill", async () => {
    resolveBillingScope.mockResolvedValue(null);
    expect((await chat([{ role: "user", content: "hi" }])).status).toBe(401);
    expect(streamOpenRouter).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the ledger cannot be read", async () => {
    currentBalance.mockRejectedValue(new Error("service role missing"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await chat([{ role: "user", content: "hi" }])).status).toBe(503);
    expect(streamOpenRouter).not.toHaveBeenCalled();
  });

  it("debits the reported cost once the stream ends, before the response closes", async () => {
    streamOpenRouter.mockImplementation(async function* (options: OpenRouterOptions) {
      yield "hello";
      options.onUsage?.({ promptTokens: 1_200, completionTokens: 40, cost: 0.0028 });
    });
    const text = await (await chat([{ role: "user", content: "hi" }])).text();
    expect(text).toBe("hello");
    expect(debitTurn).toHaveBeenCalledTimes(1);
    const [scope, requestId, model, turn, bps] = debitTurn.mock.calls[0] ?? [];
    expect(scope).toEqual(ORG);
    expect(typeof requestId).toBe("string");
    expect(model).toBe(PLATFORM.model);
    expect(turn).toEqual({
      rawCostMicros: 2_800,
      promptTokens: 1_200,
      completionTokens: 40,
      estimated: false,
    });
    expect(bps).toBe(2_000);
  });

  it("still debits a turn whose stream failed after producing text", async () => {
    const { OpenRouterError } = await import("@/lib/server/llm/openrouter-api");
    streamOpenRouter.mockImplementation(async function* () {
      yield "partial";
      throw new OpenRouterError("upstream reset", 502);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await (await chat([{ role: "user", content: "hi" }])).text();
    expect(debitTurn).toHaveBeenCalledTimes(1);
    expect(debitTurn.mock.calls[0]?.[3]).toMatchObject({ estimated: true });
  });

  it("releases the payer's turn when the stream ends, so the next message is not 409", async () => {
    await (await chat([{ role: "user", content: "one" }])).text();
    const res = await chat([{ role: "user", content: "two" }]);
    expect(res.status).toBe(200);
    await res.text();
  });

  it("refuses a second concurrent turn for the same payer", async () => {
    let finish: () => void = () => {};
    streamOpenRouter.mockImplementation(async function* () {
      yield "a";
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const first = await chat([{ role: "user", content: "one" }]);
    const reader = first.body?.getReader();
    await reader?.read();
    const second = await chat([{ role: "user", content: "two" }]);
    expect(second.status).toBe(409);
    finish();
    while (!(await reader?.read())?.done) {}
  });

  it("does not meter a path the operator is not paying for", async () => {
    resolveProvider.mockResolvedValue({ provider: "demo", model: "demo" });
    await (await chat([{ role: "user", content: "hi" }])).text();
    expect(currentBalance).not.toHaveBeenCalled();
    expect(debitTurn).not.toHaveBeenCalled();
  });
});
