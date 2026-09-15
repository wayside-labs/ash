import type { AnyReasonCode, DecisionSource, PaymentOutcome } from "@agent-rails/contract";
import type { Address } from "@solana/kit";

export type AgentRailsErrorOptions = {
  reasonCode: AnyReasonCode;
  message: string;
  /**
   * Required, not defaulted.
   *
   * A default here would be a guess about whether funds moved, and the wrong guess in the
   * permissive direction (`denied` for something that was actually broadcast) is what
   * produces a duplicate payment: a caller reads a denial as an invitation to retry. Making
   * it mandatory forces every construction site to answer the question.
   */
  outcome: PaymentOutcome;
  /** Which layer decided, for the operator's record. */
  source?: DecisionSource;
  /** Hex intent id. Present on anything raised after the id exists, denials included. */
  intentId?: string;
  /** Receipt PDA for this intent: the authoritative answer to "did it land?". */
  receipt?: Address;
  /** Set when a transaction reached the network, so an indeterminate outcome is resolvable. */
  signature?: string;
  /** Remaining budget for the denied mint, when known. */
  remaining?: bigint;
  cause?: unknown;
};

/** Typed error surfaced by the SDK, MCP tools, and adapters. */
export class AgentRailsError extends Error {
  readonly reasonCode: AnyReasonCode;
  readonly outcome: PaymentOutcome;
  readonly source?: DecisionSource;
  readonly intentId?: string;
  readonly receipt?: Address;
  readonly signature?: string;
  readonly remaining?: bigint;

  constructor(options: AgentRailsErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AgentRailsError";
    this.reasonCode = options.reasonCode;
    this.outcome = options.outcome;
    if (options.source !== undefined) this.source = options.source;
    if (options.intentId !== undefined) this.intentId = options.intentId;
    if (options.receipt !== undefined) this.receipt = options.receipt;
    if (options.signature !== undefined) this.signature = options.signature;
    if (options.remaining !== undefined) this.remaining = options.remaining;
  }

  /** Copy with payment identity attached, for layers that learn it after the throw. */
  withContext(context: {
    intentId?: string;
    receipt?: Address;
    signature?: string;
  }): AgentRailsError {
    return new AgentRailsError({
      reasonCode: this.reasonCode,
      message: this.message,
      outcome: this.outcome,
      ...(this.source !== undefined ? { source: this.source } : {}),
      ...(this.remaining !== undefined ? { remaining: this.remaining } : {}),
      intentId: context.intentId ?? this.intentId,
      receipt: context.receipt ?? this.receipt,
      signature: context.signature ?? this.signature,
      cause: this.cause,
    });
  }
}

export function isAgentRailsError(error: unknown): error is AgentRailsError {
  return error instanceof AgentRailsError;
}

/** True when the transfer may already be on-chain and the caller must resolve before retrying. */
export function isIndeterminate(error: unknown): boolean {
  return isAgentRailsError(error) && error.outcome === "indeterminate";
}
