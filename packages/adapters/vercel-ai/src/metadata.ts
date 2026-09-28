import {
  type AgentToolName,
  mcpCheckPaymentSchema,
  mcpExecutePaymentSchema,
  mcpGetPaymentStatusSchema,
  mcpGetPolicySchema,
  mcpGetSessionSchema,
  mcpListDestinationsSchema,
} from "@agent-rails/contract";
import type { z } from "zod";

/**
 * Tool copy and schemas aligned with `packages/mcp/src/tools/index.ts`.
 * Descriptions are duplicated on purpose: the adapter stays free of MCP/Solana deps.
 */
export type AgentRailsToolMeta = {
  name: AgentToolName;
  description: string;
  inputSchema: z.ZodType;
};

export const AGENT_RAILS_TOOL_METADATA: readonly AgentRailsToolMeta[] = [
  {
    name: "agent_rails_get_session",
    description:
      "Report this agent's session: expiry, revocation status, sequence number, and " +
      "per-mint spend counters including lifetime spend.",
    inputSchema: mcpGetSessionSchema,
  },
  {
    name: "agent_rails_get_policy",
    description:
      "Report the spending policy in force: per-transaction, window and lifetime limits, " +
      "destination mode, and whether a memo is required.",
    inputSchema: mcpGetPolicySchema,
  },
  {
    name: "agent_rails_list_destinations",
    description:
      "List the destinations this session may pay, by label. Use a label from this list as " +
      "destination_ref; raw addresses are refused under an allowlist policy.",
    inputSchema: mcpListDestinationsSchema,
  },
  {
    name: "agent_rails_get_payment_status",
    description:
      "Look up whether a payment settled, by intent_id. This is the authoritative answer " +
      "and the only correct response to an indeterminate outcome.",
    inputSchema: mcpGetPaymentStatusSchema,
  },
  {
    name: "agent_rails_check_payment",
    description:
      "Dry-run a payment: resolve the destination and amount, simulate it against the " +
      "policy, and report whether it would be accepted. Sends nothing and costs nothing.",
    inputSchema: mcpCheckPaymentSchema,
  },
  {
    name: "agent_rails_execute_payment",
    description:
      'Pay a registered destination. Amounts are in human units (e.g. "12.50"); the ' +
      "destination is a label; reference identifies what is being settled and makes the " +
      "payment idempotent, so retrying the same reference cannot pay twice. Returns an " +
      "outcome of settled, denied, or indeterminate.",
    inputSchema: mcpExecutePaymentSchema,
  },
];
