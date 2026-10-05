import type { AnyReasonCode, DecisionSource, PaymentOutcome } from "@ash/contract";
import type { Address } from "@solana/kit";

export type AshErrorOptions = {
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
export class AshError extends Error {
  readonly reasonCode: AnyReasonCode;
  readonly outcome: PaymentOutcome;
  readonly source?: DecisionSource;
  readonly intentId?: string;
  readonly receipt?: Address;
  readonly signature?: string;
  readonly remaining?: bigint;

  constructor(options: AshErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "AshError";
    this.reasonCode = options.reasonCode;
    this.outcome = options.outcome;
    if (options.source !== undefined) this.source = options.source;
    if (options.intentId !== undefined) this.intentId = options.intentId;
    if (options.receipt !== undefined) this.receipt = options.receipt;
    if (options.signature !== undefined) this.signature = options.signature;
    if (options.remaining !== undefined) this.remaining = options.remaining;
  }

  /** Copy with payment identity attached, for layers that learn it after the throw. */
  withContext(context: { intentId?: string; receipt?: Address; signature?: string }): AshError {
    return new AshError({
      reasonCode: this.reasonCode,
      message: this.message,
      outcome: this.outcome,
      ...(this.source !== undefined ? { source: this.source } : {}),
      ...(this.remaining !== undefined ? { remaining: this.remaining } : {}),
      ...((context.intentId ?? this.intentId) !== undefined
        ? { intentId: (context.intentId ?? this.intentId) as string }
        : {}),
      ...((context.receipt ?? this.receipt) !== undefined
        ? { receipt: (context.receipt ?? this.receipt) as Address }
        : {}),
      ...((context.signature ?? this.signature) !== undefined
        ? { signature: (context.signature ?? this.signature) as string }
        : {}),
      cause: this.cause,
    });
  }
}

export function isAshError(error: unknown): error is AshError {
  return error instanceof AshError;
}

/** True when the transfer may already be on-chain and the caller must resolve before retrying. */
export function isIndeterminate(error: unknown): boolean {
  return isAshError(error) && error.outcome === "indeterminate";
}
