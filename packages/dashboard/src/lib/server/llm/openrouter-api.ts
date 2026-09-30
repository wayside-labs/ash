/**
 * The platform-paid path: the dashboard's own OpenRouter key, so a signed-in
 * user can chat without knowing what an API key is. Plain `fetch` + an SSE
 * parser rather than a vendor SDK — the wire format is small and
 * OpenAI-compatible, and every SDK added here is one more dependency tree for
 * the audit gate to carry.
 *
 * The request never carries `tools`: the chat is read-only by construction
 * (README § Chat), and a transport that can call tools would undo that.
 */

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Fixed allowlist, never a free-form model id from the request. The prompt
 * defences in `system-prompts.ts` are instructions, not enforcement, so they are
 * only as good as the model's instruction-following — Claude-class models only.
 */
export const OPENROUTER_MODELS = [
  { id: "openrouter:anthropic/claude-sonnet-5.5", label: "Sonnet 5.5" },
  { id: "openrouter:anthropic/claude-haiku-4.5", label: "Haiku 4.5" },
] as const;

export const OPENROUTER_DEFAULT_MODEL = OPENROUTER_MODELS[0].id;

const PREFIX = "openrouter:";

export function isOpenRouterModel(id: string): boolean {
  return OPENROUTER_MODELS.some((m) => m.id === id);
}

/** Thrown for a non-2xx response or an error chunk inside a 200 stream. */
export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export type OpenRouterOptions = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** Stable per-tenant id, so OpenRouter can isolate abuse per user. */
  user?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

type Chunk = {
  choices?: { delta?: { content?: string | null } }[];
  error?: { code?: number | string; message?: string };
};

function errorFrom(body: unknown, status: number): OpenRouterError {
  const error = (body as Chunk | null)?.error;
  const code = typeof error?.code === "number" ? error.code : status;
  return new OpenRouterError(error?.message || `OpenRouter request failed (${status})`, code);
}

/**
 * Yields the parsed `data:` payload of each SSE event. OpenRouter interleaves
 * `: OPENROUTER PROCESSING` comment lines while a provider warms up; those and
 * blank separators carry nothing and are skipped.
 */
export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<unknown, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        if (data) yield JSON.parse(data);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function* streamOpenRouter(
  options: OpenRouterOptions,
): AsyncGenerator<string, void, unknown> {
  const { apiKey, model, systemPrompt, messages, user, signal, fetchImpl = fetch } = options;
  if (!isOpenRouterModel(model)) throw new OpenRouterError(`model not allowed: ${model}`, 400);

  const referer = process.env.OPENROUTER_SITE_URL;
  const response = await fetchImpl(ENDPOINT, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      ...(referer ? { "http-referer": referer } : {}),
      "x-openrouter-title": process.env.OPENROUTER_APP_TITLE || "Agent Rails Dashboard",
      // No public app page listing what treasury operators ask about.
      "x-openrouter-app-visibility": "hidden",
    },
    body: JSON.stringify({
      model: model.slice(PREFIX.length),
      // Same ceiling as the Anthropic path: a chat reply, not a document.
      max_tokens: 8192,
      stream: true,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      ...(user ? { user } : {}),
    }),
    ...(signal ? { signal } : {}),
  });

  if (!response.ok || !response.body) {
    throw errorFrom(await response.json().catch(() => null), response.status);
  }

  // After the 200 an upstream failure can only arrive as a chunk with `error`.
  for await (const chunk of parseSse(response.body)) {
    const parsed = chunk as Chunk;
    if (parsed.error) throw errorFrom(parsed, 502);
    const text = parsed.choices?.[0]?.delta?.content;
    if (text) yield text;
  }
}
