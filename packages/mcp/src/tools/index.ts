import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpRuntime } from "../config.js";
import type { SessionSigners } from "../session.js";
import { registerCheckPaymentTool } from "./check-payment.js";
import { registerExecutePaymentTool } from "./execute-payment.js";
import { registerGetPolicyTool } from "./get-policy.js";
import { registerGetSessionTool } from "./get-session.js";

export function registerTools(
  server: McpServer,
  runtime: McpRuntime,
  signers: SessionSigners,
): void {
  registerGetSessionTool(server, runtime);
  registerGetPolicyTool(server, runtime);
  registerCheckPaymentTool(server, runtime);
  registerExecutePaymentTool(server, runtime, signers);
}
