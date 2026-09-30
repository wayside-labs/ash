import { isClaudeCliModel, streamClaudeCli } from "./claude-cli";
import { type ProviderId, resolveProvider } from "./providers";
import { streamApiProvider } from "./stream";

export type Completion =
  | { ok: true; provider: Exclude<ProviderId, "demo">; text: string }
  | { ok: false; provider: "demo" };

/**
 * One whole answer from whichever provider the chat would use, for callers that need a
 * result rather than a stream (the canvas generator). Same sandbox as the chat: the CLI
 * runs with no tools and no MCP, an API provider with the caller's stored key. `demo` is reported, never
 * faked — a caller that gets it must say no model is connected.
 */
export async function completeText(input: {
  systemPrompt: string;
  prompt: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<Completion> {
  const { provider, model } = await resolveProvider(input.model);
  let source: AsyncIterable<string>;
  if (provider === "claude-cli" && isClaudeCliModel(model)) {
    source = streamClaudeCli({
      prompt: input.prompt,
      systemPrompt: input.systemPrompt,
      model,
      ...(input.signal ? { signal: input.signal } : {}),
    });
  } else if (provider === "anthropic-api" || provider === "openai-api") {
    const stream = await streamApiProvider(provider, {
      model,
      systemPrompt: input.systemPrompt,
      messages: [{ role: "user", content: input.prompt }],
      ...(input.signal ? { signal: input.signal } : {}),
    });
    if (!stream) return { ok: false, provider: "demo" };
    source = stream;
  } else {
    return { ok: false, provider: "demo" };
  }
  let text = "";
  for await (const chunk of source) text += chunk;
  return { ok: true, provider: provider as Exclude<ProviderId, "demo">, text };
}

/** The first JSON object in a model's answer, tolerating a code fence or a preamble. */
export function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("the model returned no JSON object");
  return JSON.parse(text.slice(start, end + 1));
}
