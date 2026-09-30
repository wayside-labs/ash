import { z } from "zod";
import { MAX_MEMO_LEN } from "./constants.js";

/**
 * The agent-facing tool surface (ADR-007; blueprint I-1).
 *
 * These schemas describe *only* what a model is entitled to choose. Everything that
 * identifies the treasury it pays from — `treasury`, `policy`, `session`, `allowlistEntry`,
 * `tokenProgram` — is process identity, resolved once at server start from configuration
 * and one on-chain read. It used to arrive as tool arguments, which meant the most
 * privileged fields in the payload were the ones most exposed to prompt injection; the
 * on-chain `has_one` constraints rejected incoherent combinations, but the server itself
 * had no opinion about what it was for.
 *
 * `expires_at` is server-authored for the same reason: it is the replay window, and a model
 * that picks its own can pick the widest the program allows.
 *
 * Every schema here is strict. An unknown key is a denial rather than a silently stripped
 * field, because a caller that tries to pass `treasury` is worth alerting on.
 */

const intentIdSchema = z
  .string()
  .length(32)
  .regex(/^[0-9a-f]+$/);

/**
 * A destination label, or a base58 address.
 *
 * Which of the two is acceptable is not a schema question: under a policy in `Allowlist`
 * mode the resolver refuses raw addresses outright, because an address is a value a model
 * can author and a label is a value only an operator can create (blueprint II-1).
 */
const destinationRefSchema = z
  .string()
  .min(1)
  .max(44)
  .describe('Registered destination label, e.g. "openai-billing"');

/** A decimal string in human units. Conversion uses the mint's on-chain `decimals`. */
const humanAmountSchema = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .describe('Amount in human units as a decimal string, e.g. "12.50"');

const mintRefSchema = z
  .string()
  .min(1)
  .max(44)
  .describe('Mint symbol (e.g. "USDC", "SOL") or a mint address configured on the treasury');

/** Shared free parameters of `check_payment` and `execute_payment`. */
const paymentRequestShape = {
  destination_ref: destinationRefSchema,
  amount: humanAmountSchema,
  mint_ref: mintRefSchema,
  memo: z.string().max(MAX_MEMO_LEN).optional(),
  /**
   * What this payment settles: an invoice number, a document hash, a task id. It is the
   * variable part of the idempotency key, so two attempts at the same payment collide on
   * the same receipt and the second one is refused on-chain (blueprint III-A).
   */
  reference: z
    .string()
    .min(1)
    .max(128)
    .describe("Business reference this payment settles, e.g. an invoice number"),
} as const;

/** MCP tool input for `agent_rails_execute_payment`. */
export const mcpExecutePaymentSchema = z.strictObject(paymentRequestShape);
export type McpExecutePaymentInput = z.infer<typeof mcpExecutePaymentSchema>;

/** MCP tool input for `agent_rails_check_payment` (dry run; no state change). */
export const mcpCheckPaymentSchema = z.strictObject(paymentRequestShape);
export type McpCheckPaymentInput = z.infer<typeof mcpCheckPaymentSchema>;

/**
 * MCP tool input for `agent_rails_get_payment_status`.
 *
 * The session is not a parameter: this server serves exactly one, and letting a caller name
 * another is how a read tool becomes a scanner.
 */
export const mcpGetPaymentStatusSchema = z.strictObject({
  intent_id: intentIdSchema.describe("32-character hex intent id from a payment response"),
});
export type McpGetPaymentStatusInput = z.infer<typeof mcpGetPaymentStatusSchema>;

/** MCP tool input for `agent_rails_get_session`. Reads the bound session. */
export const mcpGetSessionSchema = z.strictObject({});
export type McpGetSessionInput = z.infer<typeof mcpGetSessionSchema>;

/** MCP tool input for `agent_rails_get_policy`. Reads the bound policy. */
export const mcpGetPolicySchema = z.strictObject({});
export type McpGetPolicyInput = z.infer<typeof mcpGetPolicySchema>;

/** MCP tool input for `agent_rails_list_destinations`. */
export const mcpListDestinationsSchema = z.strictObject({});
export type McpListDestinationsInput = z.infer<typeof mcpListDestinationsSchema>;

/**
 * MCP tool input for `agent_rails_request_limit_increase` (ADR-007's `request_*` pattern).
 *
 * It grants nothing and changes nothing: the server forwards the request to the operator's
 * dashboard as an event, and a person decides — through the CLI or the dashboard — whether
 * any limit moves. `amount` is what the agent says it needs, advisory only.
 */
export const mcpRequestLimitIncreaseSchema = z.strictObject({
  reason: z
    .string()
    .min(1)
    .max(500)
    .describe("Why the current limits block the task, in one or two sentences"),
  mint_ref: mintRefSchema.optional(),
  amount: humanAmountSchema.optional(),
});
export type McpRequestLimitIncreaseInput = z.infer<typeof mcpRequestLimitIncreaseSchema>;

/**
 * The complete set of tool names this project exposes to an agent.
 *
 * Asserted against the server's registrations in CI. The list is short on purpose: every
 * name absent from it — `create_session`, `update_policy`, allowlist edits, `unpause`,
 * `withdraw` — is a privilege an agent must never hold, and the only supported pattern for
 * "the agent needs more" is a `request_*` tool that emits an off-chain event and grants
 * nothing (ADR-007).
 */
export const AGENT_TOOL_NAMES = [
  "agent_rails_get_session",
  "agent_rails_get_policy",
  "agent_rails_list_destinations",
  "agent_rails_get_payment_status",
  "agent_rails_check_payment",
  "agent_rails_execute_payment",
  "agent_rails_request_limit_increase",
] as const;

export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

/** Names that must never appear on an agent surface, in any transport or adapter. */
export const FORBIDDEN_TOOL_PATTERNS = [
  "create_session",
  "revoke_session",
  "close_session",
  "create_policy",
  "update_policy",
  "close_policy",
  "add_allowlist",
  "remove_allowlist",
  "add_mint",
  "remove_mint",
  "set_ceiling",
  "set_roles",
  "add_guardian",
  "remove_guardian",
  "pause",
  "unpause",
  "withdraw",
  "create_treasury",
  "close_treasury",
] as const;
