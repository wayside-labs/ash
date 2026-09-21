import { z } from "zod";

export const draftCanvasBlueprintInputSchema = z.object({
  title: z.string().min(1),
  workflowId: z.string().min(1),
  nodes: z.array(z.record(z.string(), z.unknown())),
  edges: z.array(z.record(z.string(), z.unknown())),
});

export type DraftCanvasBlueprintInput = z.infer<typeof draftCanvasBlueprintInputSchema>;

export type ChatStreamChunk =
  | { type: "text"; delta: string }
  | {
      type: "tool";
      toolCallId: string;
      name: "draft_canvas_blueprint";
      input: DraftCanvasBlueprintInput;
    };

export const CHAT_STREAM_NDJSON = "application/x-ndjson; charset=utf-8";

export function encodeChatStreamChunk(chunk: ChatStreamChunk): string {
  return `${JSON.stringify(chunk)}\n`;
}

export function parseChatStreamLine(line: string): ChatStreamChunk | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as ChatStreamChunk;
    if (parsed.type === "text" || parsed.type === "tool") return parsed;
    return null;
  } catch {
    return null;
  }
}
