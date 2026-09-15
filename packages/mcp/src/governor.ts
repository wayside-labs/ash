import { AgentRailsError } from "@agent-rails/sdk";
import type { Address } from "@solana/kit";

/**
 * Local velocity and concurrency control (ADR-007; blueprint III-C).
 *
 * Advisory, like everything off-chain: whoever owns this process owns the governor. Its
 * value is against the failure that actually happens — a well-behaved agent stuck in a bad
 * loop — and as the place where a quiesce can be enforced.
 *
 * The quiesce is the important part. Once a payment's outcome is unknown, this session pays
 * nothing further until that intent is resolved, because the one thing worse than a stuck
 * agent is a stuck agent that keeps paying while nobody knows whether the last one landed.
 */

export type QuiesceState = {
  intentId: string;
  receipt: Address;
  since: number;
  reason: string;
};

export type GovernorOptions = {
  maxPaymentsPerMinute: number;
  /** Injectable for tests. */
  now?: () => number;
};

export type GovernorRelease = () => void;

export class PaymentGovernor {
  private readonly maxPaymentsPerMinute: number;
  private readonly now: () => number;
  private inFlight = false;
  private timestamps: number[] = [];
  private quiesceState: QuiesceState | undefined;

  constructor(options: GovernorOptions) {
    this.maxPaymentsPerMinute = options.maxPaymentsPerMinute;
    this.now = options.now ?? (() => Date.now());
  }

  get quiesced(): QuiesceState | undefined {
    return this.quiesceState;
  }

  /**
   * Take the payment slot, or explain why not.
   *
   * Concurrency is capped at one rather than at some larger number because the on-chain
   * window counters are only consistent between transactions: two payments in flight can
   * each pass a limit check that the pair of them violates.
   */
  acquire(): GovernorRelease {
    if (this.quiesceState) {
      throw new AgentRailsError({
        reasonCode: "SESSION_QUIESCED",
        message:
          `Payment ${this.quiesceState.intentId} has an unresolved outcome. This session ` +
          "will not pay again until it is settled. Call agent_rails_get_payment_status " +
          `with intent_id ${this.quiesceState.intentId}.`,
        outcome: "denied",
        source: "governor",
        intentId: this.quiesceState.intentId,
        receipt: this.quiesceState.receipt,
      });
    }

    if (this.inFlight) {
      throw new AgentRailsError({
        reasonCode: "SESSION_BUSY",
        message: "A payment is already in flight for this session. Wait for it to finish.",
        outcome: "denied",
        source: "governor",
      });
    }

    const cutoff = this.now() - 60_000;
    this.timestamps = this.timestamps.filter((at) => at > cutoff);
    if (this.timestamps.length >= this.maxPaymentsPerMinute) {
      throw new AgentRailsError({
        reasonCode: "RATE_LIMITED",
        message:
          `This session may attempt ${this.maxPaymentsPerMinute} payments per minute. ` +
          "Slow down, or ask an operator to raise the limit.",
        outcome: "denied",
        source: "governor",
      });
    }

    this.timestamps.push(this.now());
    this.inFlight = true;

    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.inFlight = false;
      }
    };
  }

  /** Stop paying until this intent is resolved. */
  quiesce(state: Omit<QuiesceState, "since">): void {
    this.quiesceState = { ...state, since: this.now() };
  }

  /**
   * Lift the hold, once the outcome is a fact.
   *
   * Only the intent that caused the quiesce can clear it, so a later unrelated lookup
   * cannot accidentally release the session.
   */
  clearQuiesce(intentId: string): boolean {
    if (this.quiesceState?.intentId === intentId) {
      this.quiesceState = undefined;
      return true;
    }
    return false;
  }
}
