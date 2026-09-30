import { afterEach, describe, expect, it, vi } from "vitest";
import { streamOpenAiApi } from "./openai-api";

function sse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
  );
}

async function collect(source: AsyncIterable<string>): Promise<string> {
  let text = "";
  for await (const chunk of source) text += chunk;
  return text;
}

const delta = (content: string) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;

describe("streamOpenAiApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("yields deltas across chunk boundaries and stops at [DONE]", async () => {
    const body = `${delta("Hel")}${delta("lo")}data: [DONE]\n\n${delta("never")}`;
    const fetchMock = vi.fn().mockResolvedValue(sse([body.slice(0, 20), body.slice(20)]));
    vi.stubGlobal("fetch", fetchMock);

    const text = await collect(
      streamOpenAiApi({
        apiKey: "sk-a",
        model: "gpt-5",
        systemPrompt: "be brief",
        messages: [{ role: "user", content: "hi" }],
      }),
    );
    expect(text).toBe("Hello");

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const sent = JSON.parse(String(init.body)) as { messages: { role: string }[] };
    expect(sent.messages[0]).toEqual({ role: "developer", content: "be brief" });
  });

  it("sends instructions as system to older chat models", async () => {
    const fetchMock = vi.fn().mockResolvedValue(sse(["data: [DONE]\n"]));
    vi.stubGlobal("fetch", fetchMock);
    await collect(
      streamOpenAiApi({ apiKey: "k", model: "gpt-4.1", systemPrompt: "s", messages: [] }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body)).messages[0].role).toBe("system");
  });

  it("surfaces OpenAI's own error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ error: { message: "model not found" } }, { status: 404 }),
        ),
    );
    await expect(
      collect(streamOpenAiApi({ apiKey: "k", model: "x", systemPrompt: "s", messages: [] })),
    ).rejects.toThrow("model not found");
  });
});
