import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createRuntime, loadConfigFromEnv, type McpRuntime } from "./config.js";
import { loadSessionSigners, type SessionSigners } from "./session.js";
import { registerTools } from "./tools/index.js";

export const MCP_SERVER_NAME = "agent-rails";
export const MCP_SERVER_VERSION = "0.0.0";

export type CreateMcpServerOptions = {
  runtime: McpRuntime;
  signers: SessionSigners;
};

export function createMcpServer(options: CreateMcpServerOptions): McpServer {
  const server = new McpServer(
    {
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    },
    {
      instructions:
        "Agent Rails MCP server. Read tools: agent_rails_get_session, agent_rails_get_policy, " +
        "agent_rails_check_payment (idempotency receipt lookup). Write tool: " +
        "agent_rails_execute_payment (build, simulate, sign, and send). Inspect session/policy before paying; " +
        "check_payment before re-submitting an intent_id. Amounts are base units. Denials return " +
        "a stable reason_code.",
    },
  );

  registerTools(server, options.runtime, options.signers);
  return server;
}

export async function startStdioServer(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadConfigFromEnv(env);
  const runtime = createRuntime(config);
  const signers = await loadSessionSigners(runtime);
  const server = createMcpServer({ runtime, signers });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
