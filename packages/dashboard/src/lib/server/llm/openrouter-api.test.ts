import { describe, expect, it, vi } from "vitest";
import { OpenRouterError, parseSse, streamOpenRouter } from "./openrouter-api";

/** Splits on arbitrary byte boundaries: an SSE line is not a network read. */
function sseBody(text: string, chunkSize = 7): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(controller) {
      for (let i = 0; i < bytes.length; i += chunkSize) {
        controller.enqueue(bytes.slice(i, i + chunkSize));
      }
      controller.close();
    },
  });
}

function delta(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of source) out.push(item);
  return out;
}

const BASE = {
  apiKey: "sk-or-test",
  model: "openrouter:anthropic/claude-sonnet-5.5",
  systemPrompt: "SYSTEM",
  messages: [{ role: "user" as const, content: "hi" }],
};

function fakeFetch(response: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(response);
}

describe("parseSse", () => {
  it("skips comments and blank lines and stops at [DONE]", async () => {
    const body = sseBody(
      `: OPENROUTER PROCESSING\n\n${delta("a")}\r\n${delta("b")}data: [DONE]\n\n${delta("after")}`,
    );
    const events = await collect(parseSse(body));
    expect(events).toHaveLength(2);
  });
});

describe("streamOpenRouter", () => {
  it("reports the final usage chunk, cost included, exactly once", async () => {
    const usage = `data: ${JSON.stringify({
      choices: [{ delta: { content: "" } }],
      usage: { prompt_tokens: 812, completion_tokens: 64, total_tokens: 876, cost: 0.002264 },
    })}\n\n`;
    const fetchImpl = fakeFetch(
      new Response(sseBody(`${delta("hi")}${usage}data: [DONE]\n\n`), { status: 200 }),
    );
    const onUsage = vi.fn();
    expect(await collect(streamOpenRouter({ ...BASE, onUsage, fetchImpl }))).toEqual(["hi"]);
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith({
      promptTokens: 812,
      completionTokens: 64,
      cost: 0.002264,
    });
  });

  it("never reports usage for a stream that ended without it", async () => {
    const fetchImpl = fakeFetch(new Response(sseBody(`${delta("hi")}`), { status: 200 }));
    const onUsage = vi.fn();
    await collect(streamOpenRouter({ ...BASE, onUsage, fetchImpl }));
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("prices every allowlisted model, so none can be served unmetered", async () => {
    const { OPENROUTER_MODELS, OPENROUTER_PRICES } = await import("./openrouter-api");
    for (const m of OPENROUTER_MODELS) expect(OPENROUTER_PRICES[m.id]).toBeDefined();
  });

  it("yields content deltas in order", async () => {
    const fetchImpl = fakeFetch(
      new Response(sseBody(`${delta("Hel")}${delta("lo")}data: [DONE]\n\n`), { status: 200 }),
    );
    expect((await collect(streamOpenRouter({ ...BASE, fetchImpl }))).join("")).toBe("Hello");
  });

  it("sends no tools, the system prompt first, the bare model id, and the user tag", async () => {
    const fetchImpl = fakeFetch(new Response(sseBody("data: [DONE]\n\n"), { status: 200 }));
    await collect(streamOpenRouter({ ...BASE, user: "abc", fetchImpl }));

    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(body.model).toBe("anthropic/claude-sonnet-5.5");
    expect(body.messages[0]).toEqual({ role: "system", content: "SYSTEM" });
    expect(body.user).toBe("abc");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-openrouter-app-visibility"]).toBe("hidden");
    expect(headers.authorization).toBe("Bearer sk-or-test");
  });

  it("refuses a model outside the allowlist without calling out", async () => {
    const fetchImpl = fakeFetch(new Response(null, { status: 200 }));
    await expect(
      collect(streamOpenRouter({ ...BASE, model: "openrouter:some/cheap-model", fetchImpl })),
    ).rejects.toBeInstanceOf(OpenRouterError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps a non-2xx response to its status", async () => {
    const fetchImpl = fakeFetch(
      Response.json({ error: { code: 402, message: "Insufficient credits" } }, { status: 402 }),
    );
    await expect(collect(streamOpenRouter({ ...BASE, fetchImpl }))).rejects.toMatchObject({
      status: 402,
    });
  });

  it("throws on an error chunk that arrives after the 200", async () => {
    const errorChunk = `data: ${JSON.stringify({
      error: { code: "server_error", message: "Provider disconnected" },
      choices: [{ delta: { content: "" }, finish_reason: "error" }],
    })}\n\n`;
    const fetchImpl = fakeFetch(new Response(sseBody(`${delta("part")}${errorChunk}`)));
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const text of streamOpenRouter({ ...BASE, fetchImpl })) seen.push(text);
      })(),
    ).rejects.toMatchObject({ status: 502, message: "Provider disconnected" });
    expect(seen).toEqual(["part"]);
  });
});
