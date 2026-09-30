/**
 * OpenAI's Chat Completions over plain `fetch`. No SDK: streaming is a few lines of SSE, and
 * the Anthropic path already paid for the lesson that a client library can drag a dependency
 * tree of advisories in behind it.
 */

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

/** Chat model ids carry this prefix in the picker so the route knows which vendor owns them. */
export const OPENAI_MODEL_PREFIX = "openai:";

export type OpenAiApiOptions = {
  apiKey: string;
  /** The vendor's id, without {@link OPENAI_MODEL_PREFIX}. */
  model: string;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
};

/** The o-series and gpt-5 take instructions as `developer`; older chat models as `system`. */
function instructionRole(model: string): "developer" | "system" {
  return /^(o\d|gpt-5)/.test(model) ? "developer" : "system";
}

export async function* streamOpenAiApi(
  options: OpenAiApiOptions,
): AsyncGenerator<string, void, unknown> {
  const { apiKey, model, systemPrompt, messages, signal } = options;
  const res = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages: [{ role: instructionRole(model), content: systemPrompt }, ...messages],
    }),
    ...(signal ? { signal } : {}),
  });
  if (!res.ok || !res.body) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `OpenAI answered ${res.status}`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += value;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      const chunk = JSON.parse(data) as {
        error?: { message?: string };
        choices?: { delta?: { content?: string | null } }[];
      };
      if (chunk.error) throw new Error(chunk.error.message ?? "OpenAI stream error");
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  }
}
