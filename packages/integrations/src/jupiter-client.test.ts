import { describe, expect, it } from "vitest";
import { JupiterClient } from "./jupiter-client.js";

describe("JupiterClient", () => {
  it("parses a quote response", async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify({
          inputMint: "So11111111111111111111111111111111111111112",
          outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          inAmount: "1000000",
          outAmount: "990000",
          slippageBps: 50,
        }),
        { status: 200 },
      );

    const client = new JupiterClient({ baseUrl: "https://example.test", fetchImpl });
    const quote = await client.quote({
      inputMint: "So11111111111111111111111111111111111111112",
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      amount: "1000000",
    });
    expect(quote.outAmount).toBe("990000");
  });
});
