import Anthropic from "@anthropic-ai/sdk";

/**
 * The pay-per-token path, for users without Claude Code installed. Uses the
 * official SDK rather than a third-party wrapper: the wrapper pulled `undici`
 * transitively, which carried thirteen advisories, and the first-party client
 * has two dependencies and none of them.
 */

export type AnthropicApiOptions = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
};

export async function* streamAnthropicApi(
  options: AnthropicApiOptions,
): AsyncGenerator<string, void, unknown> {
  const { apiKey, model, systemPrompt, messages, signal } = options;
  const client = new Anthropic({ apiKey });

  const stream = await client.messages.create(
    {
      model,
      // A dashboard answer is deliberately short; this is a chat reply, not a
      // document, and every current model clears it comfortably.
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      stream: true,
    },
    signal ? { signal } : undefined,
  );

  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}
