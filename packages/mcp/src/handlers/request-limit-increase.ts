import { type McpRequestLimitIncreaseInput, mcpRequestLimitIncreaseSchema } from "@ash/contract";
import { isAshError } from "@ash/sdk";
import { resolveMint } from "../bound-context.js";
import type { ServerContext } from "../context.js";
import { emitAgentEvent } from "../ingest.js";

export type RequestLimitIncreaseResponse = {
  requested: boolean;
  /** Whether the request had anywhere to go. False means no dashboard is configured. */
  routed: boolean;
  message: string;
};

/**
 * ADR-007's `request_*` pattern: an agent that needs more budget says so, and that is all
 * it can do. Nothing here reads or writes a limit; the event lands in the operator's review
 * queue, and raising anything stays a privileged action on the CLI or the dashboard.
 */
export async function handleRequestLimitIncrease(
  context: ServerContext,
  rawInput: unknown,
): Promise<RequestLimitIncreaseResponse> {
  const parsed = mcpRequestLimitIncreaseSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      requested: false,
      routed: false,
      message: `Invalid request: ${parsed.error.issues.map((i) => i.message).join("; ")}`,
    };
  }
  const input: McpRequestLimitIncreaseInput = parsed.data;

  let mint: string | undefined;
  if (input.mint_ref) {
    try {
      mint = String(resolveMint(context.bound, input.mint_ref).mint);
    } catch (error) {
      if (!isAshError(error)) throw error;
      return { requested: false, routed: false, message: error.message };
    }
  }

  const routed = Boolean(context.runtime.config.ingest);
  emitAgentEvent(context, {
    schema_version: 1,
    kind: "limit_increase_requested",
    ts: new Date().toISOString(),
    request: {
      treasury: String(context.bound.treasury),
      policy: String(context.bound.policy),
      session: String(context.bound.session),
      reason: input.reason,
      ...(mint ? { mint } : {}),
      ...(input.amount ? { requested_amount: input.amount } : {}),
    },
  });

  return {
    requested: routed,
    routed,
    message: routed
      ? "Sent to the operator. Nothing changed: limits move only if a person raises them. " +
        "Carry on within the current policy, or stop and report."
      : "No operator dashboard is configured for this server, so the request went nowhere. " +
        "Tell the user in plain text what budget you need and why.",
  };
}
