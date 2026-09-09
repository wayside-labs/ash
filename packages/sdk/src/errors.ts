import type { Address } from "@solana/kit";
import type { AnyReasonCode } from "@agent-rails/contract";

export type AgentRailsErrorOptions = {
  reasonCode: AnyReasonCode;
  message: string;
  /** Remaining budget for the denied mint, when known. */
  remaining?: bigint;
  cause?: unknown;
};

/** Typed error surfaced by the SDK, MCP tools, and adapters. */
export class AgentRailsError extends Error {
  readonly reasonCode: AnyReasonCode;
  readonly remaining?: bigint;

  constructor(options: AgentRailsErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AgentRailsError";
    this.reasonCode = options.reasonCode;
    if (options.remaining !== undefined) {
      this.remaining = options.remaining;
    }
  }
}

export function isAgentRailsError(error: unknown): error is AgentRailsError {
  return error instanceof AgentRailsError;
}
