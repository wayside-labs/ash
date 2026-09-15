import { isAgentRailsError } from "@agent-rails/sdk";
import { describe, expect, it } from "vitest";
import { PaymentGovernor } from "./governor.js";
import { TEST_ALLOWLIST_ENTRY } from "./testing.js";

function reasonOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (isAgentRailsError(error)) return error.reasonCode;
    throw error;
  }
  return "no-error";
}

describe("PaymentGovernor", () => {
  it("allows one payment at a time", () => {
    const governor = new PaymentGovernor({ maxPaymentsPerMinute: 10 });
    const release = governor.acquire();

    // Two payments in flight can each pass a limit check that the pair of them violates.
    expect(reasonOf(() => governor.acquire())).toBe("SESSION_BUSY");

    release();
    expect(reasonOf(() => governor.acquire())).toBe("no-error");
  });

  it("releases idempotently", () => {
    const governor = new PaymentGovernor({ maxPaymentsPerMinute: 10 });
    const release = governor.acquire();
    release();
    release();

    expect(reasonOf(() => governor.acquire())).toBe("no-error");
  });

  it("enforces a rolling per-minute budget", () => {
    let now = 1_000_000;
    const governor = new PaymentGovernor({ maxPaymentsPerMinute: 2, now: () => now });

    governor.acquire()();
    governor.acquire()();
    expect(reasonOf(() => governor.acquire())).toBe("RATE_LIMITED");

    // The window is rolling, not a fixed bucket, so waiting past the oldest call frees it.
    now += 60_001;
    expect(reasonOf(() => governor.acquire())).toBe("no-error");
  });

  it("stops all payments while an outcome is unresolved", () => {
    const governor = new PaymentGovernor({ maxPaymentsPerMinute: 10 });
    governor.quiesce({
      intentId: "a".repeat(32),
      receipt: TEST_ALLOWLIST_ENTRY,
      reason: "confirmation timed out",
    });

    expect(reasonOf(() => governor.acquire())).toBe("SESSION_QUIESCED");
  });

  it("only lets the intent that caused a quiesce clear it", () => {
    const governor = new PaymentGovernor({ maxPaymentsPerMinute: 10 });
    governor.quiesce({
      intentId: "a".repeat(32),
      receipt: TEST_ALLOWLIST_ENTRY,
      reason: "confirmation timed out",
    });

    // An unrelated status lookup must not release the hold.
    expect(governor.clearQuiesce("b".repeat(32))).toBe(false);
    expect(reasonOf(() => governor.acquire())).toBe("SESSION_QUIESCED");

    expect(governor.clearQuiesce("a".repeat(32))).toBe(true);
    expect(reasonOf(() => governor.acquire())).toBe("no-error");
  });

  it("names the intent to resolve in the denial message", () => {
    const governor = new PaymentGovernor({ maxPaymentsPerMinute: 10 });
    governor.quiesce({
      intentId: "c".repeat(32),
      receipt: TEST_ALLOWLIST_ENTRY,
      reason: "confirmation timed out",
    });

    try {
      governor.acquire();
      throw new Error("expected a denial");
    } catch (error) {
      if (!isAgentRailsError(error)) throw error;
      expect(error.message).toContain("c".repeat(32));
      expect(error.message).toContain("agent_rails_get_payment_status");
    }
  });
});
