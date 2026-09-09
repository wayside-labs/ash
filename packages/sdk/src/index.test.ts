import { describe, expect, it } from "vitest";
import { agentRails } from "./plugin.js";
import { buildPaymentIntent, createIntentId } from "./payment-intent.js";
import { findTreasuryPda } from "./pdas.js";

describe("@agent-rails/sdk", () => {
  it("builds a payment intent with a 16-byte id", () => {
    const intentId = createIntentId();
    const intent = buildPaymentIntent({
      intentId,
      mint: "So11111111111111111111111111111111111111112",
      destination: "11111111111111111111111111111111",
      amount: 1n,
      expiresAt: 1_700_000_000,
    });
    expect(intent.intentId).toEqual(intentId);
    expect(intent.amount).toBe(1n);
  });

  it("exposes the kit plugin shape", () => {
    const plugin = agentRails({
      session: "11111111111111111111111111111111",
      signer: {
        address: "11111111111111111111111111111111" as never,
        signTransactions: async () => [],
      },
    });
    expect(plugin.session).toBe("11111111111111111111111111111111");
    expect(plugin.hooks).toEqual({});
  });

  it("derives treasury PDA seeds", async () => {
    const [address] = await findTreasuryPda({
      createKey: "11111111111111111111111111111111",
    });
    expect(address).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});
