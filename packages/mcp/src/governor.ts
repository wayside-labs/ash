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
  /**
   * Payments in flight at once. One by default.
   *
   * Raising it is a throughput choice, not a safety one: the program evaluates each payment
   * against committed counters, so a burst cannot slip past a window limit.
   */
  maxConcurrent?: number;
  /** Injectable for tests. */
  now?: () => number;
};

export type GovernorRelease = () => void;

export class PaymentGovernor {
  private readonly maxPaymentsPerMinute: number;
  private readonly maxConcurrent: number;
  private readonly now: () => number;
  private inFlight = 0;
  private timestamps: number[] = [];
  private quiesceState: QuiesceState | undefined;

  constructor(options: GovernorOptions) {
    this.maxPaymentsPerMinute = options.maxPaymentsPerMinute;
    this.maxConcurrent = options.maxConcurrent ?? 1;
    this.now = options.now ?? (() => Date.now());
  }

  get quiesced(): QuiesceState | undefined {
    return this.quiesceState;
  }

  /**
   * Take the payment slot, or explain why not.
   *
   * Concurrency defaults to one for predictability rather than for safety: the program
   * evaluates every payment against committed counters, so a burst cannot exceed a window
   * limit. What one-at-a-time buys is a session whose spending is legible in order.
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

    if (this.inFlight >= this.maxConcurrent) {
      throw new AgentRailsError({
        reasonCode: "SESSION_BUSY",
        message:
          `${this.inFlight} payment(s) already in flight and this session allows ` +
          `${this.maxConcurrent}. Wait for one to finish.`,
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
    this.inFlight += 1;

    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.inFlight -= 1;
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
