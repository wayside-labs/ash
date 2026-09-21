import type Anthropic from "@anthropic-ai/sdk";
import { type DraftCanvasBlueprintInput, draftCanvasBlueprintInputSchema } from "@/lib/chat-stream";

export const DRAFT_CANVAS_BLUEPRINT_TOOL_NAME = "draft_canvas_blueprint" as const;

export const DRAFT_CANVAS_BLUEPRINT_TOOL: Anthropic.Tool = {
  name: DRAFT_CANVAS_BLUEPRINT_TOOL_NAME,
  description:
    "Emits a structured JSON blueprint of nodes and edges for the user to visualize on the React Flow Canvas. Use this when in Design Mode or when proposing an unapproved workflow graph.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description: "Short summary of the proposed workflow (shown in the chat card).",
      },
      workflowId: {
        type: "string",
        description: "Target workflow id from the dashboard context.",
      },
      nodes: {
        type: "array",
        description:
          "React Flow nodes: treasury, agent, and action nodes with id, type, position, data.",
        items: { type: "object" },
      },
      edges: {
        type: "array",
        description: "React Flow edges linking nodes (source, target, optional label).",
        items: { type: "object" },
      },
    },
    required: ["title", "workflowId", "nodes", "edges"],
  },
};

export const CHAT_TOOLS: Anthropic.Tool[] = [DRAFT_CANVAS_BLUEPRINT_TOOL];

export const CHAT_TOOL_SYSTEM_APPENDIX = `

## Canvas blueprint tool

When proposing a workflow graph (Design Mode, mandate drafting, or capability-gap workarounds), call \`draft_canvas_blueprint\` instead of pasting raw JSON in chat.

- Set \`workflowId\` to the workflow \`id\` from context (not the display name).
- \`nodes\`: typical chain Treasury → Analysis Agent → Action (MCP) → Executor Agent.
- \`edges\`: connect the chain; gate labels go in edge \`label\` when relevant.
- Keep conversational prose in the text reply; put the graph structure in the tool call only.
- Execution remains blocked until the owner approves on canvas/chain.`;

export function parseDraftCanvasBlueprintInput(raw: unknown): DraftCanvasBlueprintInput | null {
  const parsed = draftCanvasBlueprintInputSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
