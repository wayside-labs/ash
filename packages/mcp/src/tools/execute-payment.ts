import { mcpExecutePaymentSchema } from "@agent-rails/contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleExecutePayment } from "../handlers/execute-payment.js";
import type { McpRuntime } from "../config.js";
import type { SessionSigners } from "../session.js";

export const EXECUTE_PAYMENT_TOOL_NAME = "agent_rails_execute_payment";

export function registerExecutePaymentTool(
  server: McpServer,
  runtime: McpRuntime,
  signers: SessionSigners,
): void {
  server.registerTool(
    EXECUTE_PAYMENT_TOOL_NAME,
    {
      description:
        "Build and simulate a guarded agent payment against the on-chain policy. " +
        "Returns simulation logs and compute units on success, or a stable reason_code on denial.",
      inputSchema: mcpExecutePaymentSchema,
    },
    async (input) => {
      const result = await handleExecutePayment(runtime, signers, input);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    },
  );
}
