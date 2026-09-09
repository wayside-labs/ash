import { mcpGetSessionSchema } from "@agent-rails/contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleGetSession } from "../handlers/get-session.js";
import type { McpRuntime } from "../config.js";
import { toolJsonResult } from "./response.js";

export const GET_SESSION_TOOL_NAME = "agent_rails_get_session";

export function registerGetSessionTool(server: McpServer, runtime: McpRuntime): void {
  server.registerTool(
    GET_SESSION_TOOL_NAME,
    {
      description:
        "Fetch and decode an AgentSession PDA. Returns seq, expiry, revocation status, " +
        "and per-mint spend counters including lifetime_spent.",
      inputSchema: mcpGetSessionSchema,
    },
    async (input) => toolJsonResult(await handleGetSession(runtime, input)),
  );
}
