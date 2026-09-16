import { describe, expect, it, vi } from "vitest";
import { preflightPayment } from "./preflight.js";
import { simulatePayment } from "./simulate.js";

vi.mock("./simulate.js", () => ({ simulatePayment: vi.fn() }));

describe("preflightPayment", () => {
  // It is an alias, and staying one is the whole contract: MCP servers call preflight
  // where the SDK calls simulate, and a divergence would show up as a preflight that
  // passed something simulate would have refused.
  it("delegates to simulatePayment and returns its result unchanged", async () => {
    const result = { unitsConsumed: 42_000n, logs: [] };
    vi.mocked(simulatePayment).mockResolvedValue(result as never);

    const input = { rpc: {}, transactionMessage: {} } as never;
    await expect(preflightPayment(input)).resolves.toBe(result);
    expect(simulatePayment).toHaveBeenCalledWith(input);
  });
});
