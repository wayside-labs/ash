import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearModelCatalogCache,
  isOpenAiChatModel,
  listOpenAiModels,
  OPENAI_FALLBACK_MODELS,
} from "./model-catalog";

describe("isOpenAiChatModel", () => {
  it.each(["gpt-5", "gpt-4.1", "gpt-4o-mini", "o3", "o4-mini", "chatgpt-4o-latest"])(
    "keeps %s",
    (id) => expect(isOpenAiChatModel(id)).toBe(true),
  );

  it.each([
    "text-embedding-3-large",
    "tts-1",
    "whisper-1",
    "dall-e-3",
    "gpt-image-1",
    "gpt-4o-audio-preview",
    "gpt-4o-realtime-preview",
    "gpt-4o-transcribe",
    "gpt-4o-search-preview",
    "omni-moderation-latest",
    "gpt-3.5-turbo-instruct",
    "codex-mini-latest",
    "o3-deep-research",
    "gpt-4o-2024-08-06",
    "babbage-002",
  ])("drops %s", (id) => expect(isOpenAiChatModel(id)).toBe(false));
});

describe("listOpenAiModels", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearModelCatalogCache();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("lists the key's chat models, newest first, prefixed for routing", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        data: [
          { id: "gpt-4.1", created: 100 },
          { id: "text-embedding-3-small", created: 300 },
          { id: "gpt-5", created: 200 },
        ],
      }),
    );
    expect(await listOpenAiModels("sk-a")).toEqual({
      kind: "ok",
      models: [
        { id: "openai:gpt-5", label: "gpt-5" },
        { id: "openai:gpt-4.1", label: "gpt-4.1" },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect(init.headers).toEqual({ Authorization: "Bearer sk-a" });
  });

  it("reports a refused key as rejected", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    expect(await listOpenAiModels("sk-bad")).toEqual({ kind: "rejected" });
  });

  it("falls back to the usual models when OpenAI cannot be reached", async () => {
    fetchMock.mockRejectedValue(new Error("timeout"));
    expect(await listOpenAiModels("sk-a")).toEqual({
      kind: "unreachable",
      models: OPENAI_FALLBACK_MODELS,
    });
  });

  it("asks once per key within the cache window", async () => {
    fetchMock.mockImplementation(async () => Response.json({ data: [{ id: "gpt-5" }] }));
    await listOpenAiModels("sk-a");
    await listOpenAiModels("sk-a");
    await listOpenAiModels("sk-b");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
