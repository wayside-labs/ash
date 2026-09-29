import { describe, expect, it } from "vitest";
import {
  AGENT_EVENT_KINDS,
  agentEventSchema,
  agentEventTreasury,
  buildPaymentDeniedAlert,
  headroomBps,
} from "./alerts.js";

describe("alert payloads", () => {
  it("computes headroom basis points", () => {
    expect(headroomBps(800n, 1000n)).toBe(2000);
    expect(headroomBps(1000n, 1000n)).toBe(0);
  });

  it("builds payment_denied with treasury context", () => {
    const payload = buildPaymentDeniedAlert({
      treasury: "CzMHCrWhbCqVMDTNDriaMAcJ1mS5LLKGKGKpTLtHnGTW",
      session: "22222222222222222222222222222222",
      intent: "c".repeat(32),
      reason_code: "HOOK_DENIED",
      source: "hook",
    });
    expect(payload.kind).toBe("payment_denied");
    if (payload.kind !== "payment_denied") {
      throw new Error("expected payment_denied");
    }
    expect(payload.denial.reason_code).toBe("HOOK_DENIED");
  });
});

describe("agent events", () => {
  const base = {
    treasury: "BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w",
    policy: "H4HU1sPoevCGqHeFQiyW5Q8NVmQgAb1DyZgP2LSzwMPE",
    session: "3tvQknH6RHfnssAGgC64z7KkejwrQ3USftxosmoimX4z",
  };

  it("accepts every alert and both agent-only kinds", () => {
    const review = agentEventSchema.parse({
      schema_version: 1,
      kind: "payment_review_required",
      ts: "2026-09-28T00:00:00.000Z",
      review: {
        ...base,
        intent_id: "a".repeat(32),
        destination: base.session,
        mint: "So11111111111111111111111111111111111111112",
        amount: "1000",
        reference: "inv_1",
      },
    });
    expect(agentEventTreasury(review)).toBe(base.treasury);
    const request = agentEventSchema.parse({
      schema_version: 1,
      kind: "limit_increase_requested",
      ts: "2026-09-28T00:00:00.000Z",
      request: { ...base, reason: "vendor raised prices" },
    });
    expect(request.kind).toBe("limit_increase_requested");
    expect(AGENT_EVENT_KINDS).toHaveLength(agentEventSchema.options.length);
  });

  it("refuses a malformed intent id or a float amount", () => {
    const bad = {
      schema_version: 1,
      kind: "payment_review_required",
      ts: "t",
      review: {
        ...base,
        intent_id: "xyz",
        destination: base.session,
        mint: base.session,
        amount: "1.5",
        reference: "r",
      },
    };
    expect(agentEventSchema.safeParse(bad).success).toBe(false);
  });
});
