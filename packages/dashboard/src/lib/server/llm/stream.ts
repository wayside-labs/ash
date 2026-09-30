import { streamAnthropicApi } from "./anthropic-api";
import { OPENAI_MODEL_PREFIX, streamOpenAiApi } from "./openai-api";
import { type ApiProviderId, providerApiKey } from "./providers";

export type ApiStreamInput = {
  model: string;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
};

/** A reply stream from one of the key-based providers, or null when the caller has no key. */
export async function streamApiProvider(
  provider: ApiProviderId,
  input: ApiStreamInput,
): Promise<AsyncIterable<string> | null> {
  const apiKey = await providerApiKey(provider);
  if (!apiKey) return null;
  const signal = input.signal ? { signal: input.signal } : {};
  if (provider === "openai-api") {
    return streamOpenAiApi({
      apiKey,
      model: input.model.startsWith(OPENAI_MODEL_PREFIX)
        ? input.model.slice(OPENAI_MODEL_PREFIX.length)
        : input.model,
      systemPrompt: input.systemPrompt,
      messages: input.messages,
      ...signal,
    });
  }
  return streamAnthropicApi({
    apiKey,
    model: input.model,
    systemPrompt: input.systemPrompt,
    messages: input.messages,
    ...signal,
  });
}
