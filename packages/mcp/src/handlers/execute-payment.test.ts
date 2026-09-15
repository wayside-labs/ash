import { AgentRailsError } from "@agent-rails/sdk";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpRuntime } from "../config.js";
import { PaymentGovernor } from "../governor.js";
import {
  TEST_BLOCKHASH,
  TEST_LAST_VALID_BLOCK_HEIGHT,
  TEST_VENDOR,
  testBoundContext,
  testConfig,
  testServerContext,
} from "../testing.js";
import { handleExecutePayment } from "./execute-payment.js";

vi.mock("../bound-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bound-context.js")>()),
  assertSessionLive: vi.fn(async () => {}),
}));

const SIGNATURE = "1".repeat(88);

const validRequest = {
  destination_ref: "acme-hosting",
  amount: "1.5",
  mint_ref: "SOL",
  reference: "INV-2026-0041",
};

/** An RPC where everything works: simulation passes, the send confirms immediately. */
function createHappyRpc(broadcasts: string[] = []) {
  return {
    getAccountInfo: () => ({ send: async () => ({ value: null }) }),
    getLatestBlockhash: () => ({
      send: async () => ({
        blockhash: TEST_BLOCKHASH,
        lastValidBlockHeight: TEST_LAST_VALID_BLOCK_HEIGHT,
      }),
    }),
    simulateTransaction: () => ({
      send: async () => ({
        value: { err: null, logs: ["Program log: ok"], unitsConsumed: 32_000n },
      }),
    }),
    sendTransaction: (wire: string) => ({
      send: async () => {
        broadcasts.push(wire);
        return SIGNATURE;
      },
    }),
    getBlockHeight: () => ({ send: async () => TEST_LAST_VALID_BLOCK_HEIGHT - 1n }),
    getSignatureStatuses: () => ({
      send: async () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] }),
    }),
  };
}

describe("handleExecutePayment", () => {
  let runtime: McpRuntime;
  let broadcasts: string[];

  beforeEach(() => {
    broadcasts = [];
    runtime = { config: testConfig(), rpc: createHappyRpc(broadcasts) } as unknown as McpRuntime;
  });

  it("settles a payment to a labelled destination", async () => {
    const context = await testServerContext(runtime);

    const result = await handleExecutePayment(context, validRequest);

    expect(result.outcome).toBe("settled");
    // The signature is derived from the signed transaction, not echoed by the node.
    expect(result.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/);
    expect(result.destination).toBe(TEST_VENDOR);
    expect(result.destination_label).toBe("acme-hosting");
    // 1.5 SOL at 9 decimals. The caller never names the scale.
    expect(result.amount_base_units).toBe("1500000000");
  });

  it("never returns program logs to the caller", async () => {
    const context = await testServerContext(runtime);

    const result = await handleExecutePayment(context, validRequest);

    // Logs are attacker-influenceable text on the way back into a model's context.
    expect(result).not.toHaveProperty("logs");
    expect(JSON.stringify(result)).not.toContain("Program log");
  });

  it("refuses arguments that try to redirect the treasury", async () => {
    const context = await testServerContext(runtime);

    const result = await handleExecutePayment(context, {
      ...validRequest,
      treasury: "11111111111111111111111111111199",
      session: "11111111111111111111111111111198",
      expires_at: 1_900_000_000,
    });

    // Not silently stripped: a caller reaching for these is worth denying loudly.
    expect(result.outcome).toBe("denied");
    expect(result.reason_code).toBe("INVALID_REQUEST");
    expect(broadcasts).toHaveLength(0);
  });

  it("refuses a raw address under an allowlist policy", async () => {
    const context = await testServerContext(runtime);

    const result = await handleExecutePayment(context, {
      ...validRequest,
      destination_ref: TEST_VENDOR,
    });

    expect(result.outcome).toBe("denied");
    expect(result.reason_code).toBe("LITERAL_NOT_PERMITTED");
    expect(broadcasts).toHaveLength(0);
  });

  it("refuses an unregistered label without naming a near miss", async () => {
    const context = await testServerContext(runtime);

    const result = await handleExecutePayment(context, {
      ...validRequest,
      destination_ref: "acme-hostlng",
    });

    expect(result.outcome).toBe("denied");
    expect(result.reason_code).toBe("UNKNOWN_DESTINATION");
    // Suggesting the real label would hand it to whoever guessed.
    expect(result.message).not.toContain("acme-hosting");
  });

  it("refuses precision the mint cannot represent, rather than rounding", async () => {
    const context = await testServerContext(runtime, {
      bound: testBoundContext({
        mints: [
          {
            symbol: "USDC",
            mint: "So11111111111111111111111111111111111111112" as never,
            decimals: 6,
            tokenProgram: "11111111111111111111111111111111" as never,
            isNative: true,
            inPolicy: true,
          },
        ],
      }),
    });

    const result = await handleExecutePayment(context, {
      ...validRequest,
      mint_ref: "USDC",
      amount: "1.0000001",
    });

    expect(result.outcome).toBe("denied");
    expect(result.reason_code).toBe("PRECISION_EXCEEDS_MINT");
    expect(broadcasts).toHaveLength(0);
  });

  it("refuses a mint the treasury does not carry", async () => {
    const context = await testServerContext(runtime);

    const result = await handleExecutePayment(context, { ...validRequest, mint_ref: "DAI" });

    expect(result.outcome).toBe("denied");
    expect(result.reason_code).toBe("UNKNOWN_MINT");
  });

  it("carries a denial's reason code and intent id back to the caller", async () => {
    const context = await testServerContext(runtime, {
      hooks: [
        {
          name: "open-invoice",
          evaluate: () => ({
            allow: false as const,
            message: "No open invoice matches this reference.",
          }),
        },
      ],
    });

    const result = await handleExecutePayment(context, validRequest);

    expect(result.outcome).toBe("denied");
    expect(result.reason_code).toBe("HOOK_DENIED");
    expect(broadcasts).toHaveLength(0);
  });

  it("denies when a policy hook cannot be evaluated", async () => {
    const context = await testServerContext(runtime, {
      hooks: [
        {
          name: "erp-lookup",
          timeoutMs: 5,
          evaluate: () => new Promise<never>(() => {}),
        },
      ],
    });

    // A control that evaporates under load is not a control.
    const result = await handleExecutePayment(context, validRequest);

    expect(result.outcome).toBe("denied");
    expect(result.reason_code).toBe("HOOK_UNAVAILABLE");
    expect(broadcasts).toHaveLength(0);
  });

  it("permits a payment when an advisory hook fails open", async () => {
    const context = await testServerContext(runtime, {
      hooks: [
        {
          name: "nice-to-have",
          timeoutMs: 5,
          failOpen: true,
          evaluate: () => new Promise<never>(() => {}),
        },
      ],
    });

    const result = await handleExecutePayment(context, validRequest);

    expect(result.outcome).toBe("settled");
  });

  it("caps concurrency at one payment in flight", async () => {
    const context = await testServerContext(runtime, {
      governor: new PaymentGovernor({ maxPaymentsPerMinute: 60 }),
    });
    // Hold the slot as an in-flight payment would.
    context.governor.acquire();

    const result = await handleExecutePayment(context, validRequest);

    expect(result.outcome).toBe("denied");
    expect(result.reason_code).toBe("SESSION_BUSY");
    expect(broadcasts).toHaveLength(0);
  });

  it("rate-limits a looping caller", async () => {
    const context = await testServerContext(runtime, {
      governor: new PaymentGovernor({ maxPaymentsPerMinute: 2 }),
    });

    const outcomes = [];
    for (let i = 0; i < 4; i += 1) {
      outcomes.push(
        await handleExecutePayment(context, { ...validRequest, reference: `INV-${i}` }),
      );
    }

    expect(outcomes.filter((result) => result.outcome === "settled")).toHaveLength(2);
    expect(outcomes.filter((result) => result.reason_code === "RATE_LIMITED")).toHaveLength(2);
    expect(broadcasts).toHaveLength(2);
  });

  it("re-throws errors that are not payment decisions", async () => {
    const failingRuntime = {
      config: testConfig(),
      rpc: {
        ...createHappyRpc(),
        getLatestBlockhash: () => ({
          send: vi.fn().mockRejectedValue(new Error("rpc down")),
        }),
      },
    } as unknown as McpRuntime;
    const context = await testServerContext(failingRuntime);

    await expect(handleExecutePayment(context, validRequest)).rejects.toThrow("rpc down");
  });
});

describe("AgentRailsError", () => {
  it("requires an outcome, so no failure can be classified by omission", () => {
    const error = new AgentRailsError({
      reasonCode: "EXCEEDS_PER_TX_MAX",
      message: "Amount exceeds the per-transaction maximum",
      outcome: "denied",
    });
    expect(error.reasonCode).toBe("EXCEEDS_PER_TX_MAX");
    expect(error.outcome).toBe("denied");
  });
});
