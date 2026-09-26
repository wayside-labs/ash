import { buildHeadroomLowAlert, buildPaymentDeniedAlert } from "@agent-rails/contract/alerts";
import { describe, expect, it } from "vitest";

/**
 * Dashboard-side contract on alert payloads (F8 / P1-03). Delivery lives in `@agent-rails/sdk`.
 */
describe("alert webhook payloads", () => {
  it("serializes payment_denied for generic webhooks", () => {
    const payload = buildPaymentDeniedAlert({
      ts: "2026-09-26T15:00:00.000Z",
      treasury: "CzMHCrWhbCqVMDTNDriaMAcJ1mS5LLKGKGKpTLtHnGTW",
      policy: "11111111111111111111111111111112",
      session: "22222222222222222222222222222222",
      intent: "b".repeat(32),
      reason_code: "EXCEEDS_SHORT_WINDOW",
      source: "simulation",
    });
    expect(payload).toMatchObject({
      schema_version: 1,
      kind: "payment_denied",
      denial: {
        reason_code: "EXCEEDS_SHORT_WINDOW",
        source: "simulation",
      },
    });
  });

  it("serializes headroom_low when remaining headroom is below 20%", () => {
    const payload = buildHeadroomLowAlert({
      headroom: {
        treasury: "CzMHCrWhbCqVMDTNDriaMAcJ1mS5LLKGKGKpTLtHnGTW",
        session: "22222222222222222222222222222222",
        policy: "11111111111111111111111111111112",
        mint: "So11111111111111111111111111111111111111112",
        window: "long",
        spent: "9000000000",
        limit: "10000000000",
        headroom_bps: 1000,
        headroom_threshold_bps: 2000,
      },
    });
    expect(payload.kind).toBe("headroom_low");
    expect(payload.headroom.headroom_bps).toBeLessThan(payload.headroom.headroom_threshold_bps);
  });
});
