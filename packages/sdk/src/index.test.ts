import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { findTreasuryPda } from "./pdas.js";
import { agentRails } from "./plugin.js";

describe("@agent-rails/sdk", () => {
  it("exposes the kit plugin shape", () => {
    const plugin = agentRails({
      session: address("11111111111111111111111111111111"),
      signer: {
        address: address("11111111111111111111111111111111"),
        signTransactions: async () => [],
      },
    });
    expect(plugin.session).toBe("11111111111111111111111111111111");
    // A posture is always resolved, so no caller has to check whether one exists.
    expect(plugin.security.preset).toBe("balanced");
    expect(plugin.security.posture.destinations.policy).toBe("labels-only");
  });

  it("resolves the requested posture at construction", () => {
    const plugin = agentRails({
      session: address("11111111111111111111111111111111"),
      signer: {
        address: address("11111111111111111111111111111111"),
        signTransactions: async () => [],
      },
      security: { preset: "sandbox" },
    });
    expect(plugin.security.posture.destinations.policy).toBe("open");
  });

  it("rejects a malformed posture when the client is built, not when it pays", () => {
    expect(() =>
      agentRails({
        session: address("11111111111111111111111111111111"),
        signer: {
          address: address("11111111111111111111111111111111"),
          signTransactions: async () => [],
        },
        security: { posture: { velocity: { maxConcurrent: 0 } } },
      }),
    ).toThrow();
  });

  it("derives treasury PDA seeds", async () => {
    const [treasury] = await findTreasuryPda({
      createKey: address("11111111111111111111111111111111"),
    });
    expect(treasury).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });
});
