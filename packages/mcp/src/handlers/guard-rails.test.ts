import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpRuntime } from "../config.js";
import { createDryRunLedger } from "../dry-runs.js";
import { PaymentGovernor } from "../governor.js";
import {
  TEST_BLOCKHASH,
  TEST_LAST_VALID_BLOCK_HEIGHT,
  TEST_VENDOR,
  testConfig,
  testSecurity,
  testServerContext,
} from "../testing.js";
import { handleCheckPayment } from "./check-payment.js";
import { handleExecutePayment } from "./execute-payment.js";

/**
 * The configurable guard-rails, at the point where they actually bite.
 *
 * The rule every case here is checking: a posture may move a refusal earlier or give it up,
 * and may never move the floor. Where a knob is relaxed, the test says what still catches
 * the mistake underneath.
 */

vi.mock("../bound-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bound-context.js")>()),
  assertSessionLive: vi.fn(async () => {}),
}));

const request = {
  destination_ref: "acme-hosting",
  amount: "1.5",
  mint_ref: "SOL",
  reference: "INV-2026-0041",
};

function createRpc(broadcasts: string[] = []) {
  return {
    getAccountInfo: () => ({ send: async () => ({ value: null }) }),
    getLatestBlockhash: () => ({
      send: async () => ({
        context: { slot: 1n },
        value: {
          blockhash: TEST_BLOCKHASH,
          lastValidBlockHeight: TEST_LAST_VALID_BLOCK_HEIGHT,
        },
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
        return "1".repeat(88);
      },
    }),
    getBlockHeight: () => ({ send: async () => TEST_LAST_VALID_BLOCK_HEIGHT - 1n }),
    getSignatureStatuses: () => ({
      send: async () => ({ value: [{ err: null, confirmationStatus: "confirmed" }] }),
    }),
  };
}

describe("destination policy", () => {
  let runtime: McpRuntime;
  let broadcasts: string[];

  beforeEach(() => {
    broadcasts = [];
    runtime = { config: testConfig(), rpc: createRpc(broadcasts) } as unknown as McpRuntime;
  });

  it("refuses a raw address under labels-only", async () => {
    const context = await testServerContext(runtime, {
      security: testSecurity({
        posture: { destinations: { policy: "labels-only", nearMissDistance: 2 } },
      }),
    });

    const result = await handleExecutePayment(context, {
      ...request,
      destination_ref: TEST_VENDOR,
    });

    expect(result.reason_code).toBe("LITERAL_NOT_PERMITTED");
    expect(broadcasts).toHaveLength(0);
  });

  it("still refuses a raw address under an open posture when the chain is allowlisted", async () => {
    const context = await testServerContext(runtime, {
      security: testSecurity({
        posture: { destinations: { policy: "open", nearMissDistance: 0 } },
      }),
    });

    // The bound policy is in Allowlist mode. Relaxing the client cannot grant what the
    // program refuses, and the client declines to build a transaction it knows will fail.
    const result = await handleExecutePayment(context, {
      ...request,
      destination_ref: TEST_VENDOR,
    });

    expect(result.outcome).toBe("denied");
    expect(broadcasts).toHaveLength(0);
  });
});

describe("value bands", () => {
  let runtime: McpRuntime;
  let broadcasts: string[];

  beforeEach(() => {
    broadcasts = [];
    runtime = { config: testConfig(), rpc: createRpc(broadcasts) } as unknown as McpRuntime;
  });

  it("requires a memo above the configured amount and not below it", async () => {
    const security = testSecurity({
      posture: { value: { bands: [{ above: "1", require: ["memo"] }] } },
    });

    const overBand = await handleExecutePayment(
      await testServerContext(runtime, { security }),
      request,
    );
    expect(overBand.reason_code).toBe("MEMO_REQUIRED");

    const underBand = await handleExecutePayment(await testServerContext(runtime, { security }), {
      ...request,
      amount: "0.5",
    });
    expect(underBand.outcome).toBe("settled");
  });

  it("holds a large payment for review instead of sending it", async () => {
    const context = await testServerContext(runtime, {
      security: testSecurity({
        posture: { value: { bands: [{ above: "1", require: ["human-review"] }] } },
      }),
    });

    const result = await handleExecutePayment(context, request);

    // Terminal, not a denial: a retryable answer would have the agent loop against the gate.
    expect(result.outcome).toBe("review_required");
    expect(result.intent_id).toMatch(/^[0-9a-f]{32}$/);
    expect(broadcasts).toHaveLength(0);
  });

  it("requires a dry run of the same payment first", async () => {
    const security = testSecurity({
      posture: { value: { bands: [{ above: "1", require: ["dry-run-first"] }] } },
    });
    const dryRuns = createDryRunLedger();
    const context = await testServerContext(runtime, { security, dryRuns });

    const blocked = await handleExecutePayment(context, request);
    expect(blocked.reason_code).toBe("DRY_RUN_REQUIRED");
    expect(broadcasts).toHaveLength(0);

    await handleCheckPayment(context, request);
    const allowed = await handleExecutePayment(context, request);
    expect(allowed.outcome).toBe("settled");
  });

  it("is not satisfied by a dry run of a different payment", async () => {
    const security = testSecurity({
      posture: { value: { bands: [{ above: "1", require: ["dry-run-first"] }] } },
    });
    const dryRuns = createDryRunLedger();
    const context = await testServerContext(runtime, { security, dryRuns });

    // Checking something cheap must not unlock something expensive. The ledger is keyed by
    // the derived intent id, so it only matches the same payment.
    await handleCheckPayment(context, { ...request, amount: "0.01" });
    const result = await handleExecutePayment(context, request);

    expect(result.reason_code).toBe("DRY_RUN_REQUIRED");
  });

  it("makes hook failures deny above the band even when the posture fails open", async () => {
    const context = await testServerContext(runtime, {
      security: testSecurity({
        preset: "sandbox",
        posture: { value: { bands: [{ above: "1", require: ["hooks"] }] } },
        hooks: [{ name: "erp", timeoutMs: 5, evaluate: () => new Promise<never>(() => {}) }],
      }),
    });

    const result = await handleExecutePayment(context, request);

    expect(result.reason_code).toBe("HOOK_UNAVAILABLE");
    expect(broadcasts).toHaveLength(0);
  });
});

describe("outcome and disclosure knobs", () => {
  let runtime: McpRuntime;
  let broadcasts: string[];

  beforeEach(() => {
    broadcasts = [];
    runtime = { config: testConfig(), rpc: createRpc(broadcasts) } as unknown as McpRuntime;
  });

  it("withholds simulation logs unless a developer asks for them", async () => {
    const withheld = await handleExecutePayment(await testServerContext(runtime), request);
    expect(withheld).not.toHaveProperty("simulation_logs");

    const shown = await handleExecutePayment(
      await testServerContext(runtime, {
        security: testSecurity({
          posture: { disclosure: { includeSimulationLogs: true } },
        }),
      }),
      request,
    );
    expect(shown.simulation_logs).toEqual(["Program log: ok"]);
  });

  it("allows more than one payment in flight when configured to", async () => {
    const context = await testServerContext(runtime, {
      governor: new PaymentGovernor({ maxPaymentsPerMinute: 60, maxConcurrent: 2 }),
    });
    context.governor.acquire();

    // Safe to raise: the program evaluates each payment against committed counters, so a
    // burst cannot slip past a window limit.
    const result = await handleExecutePayment(context, request);
    expect(result.outcome).toBe("settled");

    context.governor.acquire();
    const third = await handleExecutePayment(context, request);
    expect(third.reason_code).toBe("SESSION_BUSY");
  });
});
