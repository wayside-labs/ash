import { describe, expect, it } from "vitest";
import { findTreasuryPda } from "./pdas.js";
import { agentRails } from "./plugin.js";

describe("@agent-rails/sdk", () => {
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
