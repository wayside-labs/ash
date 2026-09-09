import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRuntime } from "../config.js";
import type { SessionSigners } from "../session.js";
import { registerExecutePaymentTool } from "./execute-payment.js";

export function registerTools(
  server: McpServer,
  runtime: McpRuntime,
  signers: SessionSigners,
): void {
  registerExecutePaymentTool(server, runtime, signers);
}
