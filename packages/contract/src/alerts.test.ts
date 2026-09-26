import { describe, expect, it } from "vitest";
import { buildPaymentDeniedAlert, headroomBps } from "./alerts.js";

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
