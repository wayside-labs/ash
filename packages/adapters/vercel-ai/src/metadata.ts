import {
  type AgentToolName,
  mcpCheckPaymentSchema,
  mcpExecutePaymentSchema,
  mcpGetPaymentStatusSchema,
  mcpGetPolicySchema,
  mcpGetSessionSchema,
  mcpListDestinationsSchema,
  mcpRequestLimitIncreaseSchema,
} from "@ash/contract";
import type { z } from "zod";

/**
 * Tool copy and schemas aligned with `packages/mcp/src/tools/index.ts`.
 * Descriptions are duplicated on purpose: the adapter stays free of MCP/Solana deps.
 */
export type AshToolMeta = {
  name: AgentToolName;
  description: string;
  inputSchema: z.ZodType;
};

export const ASH_TOOL_METADATA: readonly AshToolMeta[] = [
  {
    name: "ash_get_session",
    description:
      "Report this agent's session: expiry, revocation status, sequence number, and " +
      "per-mint spend counters including lifetime spend.",
    inputSchema: mcpGetSessionSchema,
  },
  {
    name: "ash_get_policy",
    description:
      "Report the spending policy in force: per-transaction, window and lifetime limits, " +
      "destination mode, and whether a memo is required.",
    inputSchema: mcpGetPolicySchema,
  },
  {
    name: "ash_list_destinations",
    description:
      "List the destinations this session may pay, by label. Use a label from this list as " +
      "destination_ref; raw addresses are refused under an allowlist policy.",
    inputSchema: mcpListDestinationsSchema,
  },
  {
    name: "ash_get_payment_status",
    description:
      "Look up whether a payment settled, by intent_id. This is the authoritative answer " +
      "and the only correct response to an indeterminate outcome.",
    inputSchema: mcpGetPaymentStatusSchema,
  },
  {
    name: "ash_check_payment",
    description:
      "Dry-run a payment: resolve the destination and amount, simulate it against the " +
      "policy, and report whether it would be accepted. Sends nothing and costs nothing.",
    inputSchema: mcpCheckPaymentSchema,
  },
  {
    name: "ash_execute_payment",
    description:
      'Pay a registered destination. Amounts are in human units (e.g. "12.50"); the ' +
      "destination is a label; reference identifies what is being settled and makes the " +
      "payment idempotent, so retrying the same reference cannot pay twice. Returns an " +
      "outcome of settled, denied, or indeterminate.",
    inputSchema: mcpExecutePaymentSchema,
  },
  {
    name: "ash_request_limit_increase",
    description:
      "Ask the operator for more budget when the current limits block a legitimate task. " +
      "This only sends a message; it changes no limit, and you must keep working within the " +
      "current policy or stop.",
    inputSchema: mcpRequestLimitIncreaseSchema,
  },
];
