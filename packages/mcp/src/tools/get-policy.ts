import { mcpGetPolicySchema } from "@agent-rails/contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleGetPolicy } from "../handlers/get-policy.js";
import type { McpRuntime } from "../config.js";
import { toolJsonResult } from "./response.js";

export const GET_POLICY_TOOL_NAME = "agent_rails_get_policy";

export function registerGetPolicyTool(server: McpServer, runtime: McpRuntime): void {
  server.registerTool(
    GET_POLICY_TOOL_NAME,
    {
      description:
        "Fetch and decode a Policy PDA. Returns per-mint limits (per_tx_max, window caps, " +
        "lifetime_max), destination mode, and memo requirements.",
      inputSchema: mcpGetPolicySchema,
    },
    async (input) => toolJsonResult(await handleGetPolicy(runtime, input)),
  );
}
