import { mcpCheckPaymentSchema } from "@agent-rails/contract";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { handleCheckPayment } from "../handlers/check-payment.js";
import type { McpRuntime } from "../config.js";
import { toolJsonResult } from "./response.js";

export const CHECK_PAYMENT_TOOL_NAME = "agent_rails_check_payment";

export function registerCheckPaymentTool(server: McpServer, runtime: McpRuntime): void {
  server.registerTool(
    CHECK_PAYMENT_TOOL_NAME,
    {
      description:
        "Check whether an IntentReceipt PDA exists for a given intent_id. " +
        "Use before execute_payment to verify idempotency — a receipt means the payment already landed.",
      inputSchema: mcpCheckPaymentSchema,
    },
    async (input) => toolJsonResult(await handleCheckPayment(runtime, input)),
  );
}
