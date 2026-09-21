import Anthropic from "@anthropic-ai/sdk";
import { type ChatStreamChunk, encodeChatStreamChunk } from "@/lib/chat-stream";
import { CHAT_TOOLS, parseDraftCanvasBlueprintInput } from "@/lib/server/llm/chat-tools";

/**
 * The pay-per-token path, for users without Claude Code installed. Uses the
 * official SDK rather than a third-party wrapper: the wrapper pulled `undici`
 * transitively, which carried thirteen advisories, and the first-party client
 * has two dependencies and none of them.
 */

export const ANTHROPIC_API_MODELS = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
] as const;

export function isAnthropicApiModel(id: string): boolean {
  return ANTHROPIC_API_MODELS.some((m) => m.id === id);
}

export type AnthropicApiOptions = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  messages: { role: "user" | "assistant"; content: string }[];
  signal?: AbortSignal;
  tools?: boolean;
};

type ActiveToolCall = {
  id: string;
  name: string;
  inputJson: string;
};

export async function* streamAnthropicApi(
  options: AnthropicApiOptions,
): AsyncGenerator<ChatStreamChunk, void, unknown> {
  const { apiKey, model, systemPrompt, messages, signal, tools = true } = options;
  const client = new Anthropic({ apiKey });

  const stream = await client.messages.create(
    {
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages,
      stream: true,
      ...(tools ? { tools: CHAT_TOOLS } : {}),
    },
    signal ? { signal } : undefined,
  );

  let activeTool: ActiveToolCall | null = null;

  for await (const event of stream) {
    if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        activeTool = {
          id: event.content_block.id,
          name: event.content_block.name,
          inputJson: "",
        };
      }
      continue;
    }

    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        yield { type: "text", delta: event.delta.text };
        continue;
      }

      if (event.delta.type === "input_json_delta" && activeTool) {
        activeTool.inputJson += event.delta.partial_json;
      }
      continue;
    }

    if (event.type === "content_block_stop" && activeTool) {
      try {
        const raw = JSON.parse(activeTool.inputJson || "{}") as unknown;
        const input = parseDraftCanvasBlueprintInput(raw);
        if (input) {
          yield {
            type: "tool",
            toolCallId: activeTool.id,
            name: "draft_canvas_blueprint",
            input,
          };
        }
      } catch {
        // Malformed tool JSON — skip rather than crash the stream.
      }
      activeTool = null;
    }
  }
}

export async function* streamAnthropicApiPlainText(
  options: AnthropicApiOptions,
): AsyncGenerator<string, void, unknown> {
  for await (const chunk of streamAnthropicApi({ ...options, tools: false })) {
    if (chunk.type === "text") yield chunk.delta;
  }
}

export function chatStreamToNdjson(
  source: AsyncIterable<ChatStreamChunk>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of source) {
          controller.enqueue(encoder.encode(encodeChatStreamChunk(chunk)));
        }
      } finally {
        controller.close();
      }
    },
  });
}
