import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpRuntime } from "../config.js";
import {
  TEST_BLOCKHASH,
  TEST_LAST_VALID_BLOCK_HEIGHT,
  testConfig,
  testSecurity,
  testServerContext,
} from "../testing.js";
import { handleExecutePayment } from "./execute-payment.js";
import { handleRequestLimitIncrease } from "./request-limit-increase.js";

/**
 * The human-review gate routed through the operator dashboard (ADR-022), and the
 * `request_limit_increase` tool. The dashboard is a fetch stub: a map of intent id to
 * decision, and a list of the events it received.
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

const INGEST = { url: "https://dash.example/api/ingest", token: "tok" };

describe("review routed through the dashboard", () => {
  let runtime: McpRuntime;
  let broadcasts: string[];
  let decisions: Map<string, string>;
  let events: { kind: string; review?: { intent_id: string } }[];
  let reachable: boolean;
  const security = testSecurity({
    posture: { value: { bands: [{ above: "1", require: ["human-review"] }] } },
  });

  beforeEach(() => {
    broadcasts = [];
    decisions = new Map();
    events = [];
    reachable = true;
    runtime = {
      config: { ...testConfig(), ingest: INGEST },
      rpc: createRpc(broadcasts),
    } as unknown as McpRuntime;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (!reachable) throw new Error("offline");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
      if (url === `${INGEST.url}/events`) {
        events.push(JSON.parse(String(init?.body)));
        return new Response(null, { status: 202 });
      }
      const intent = url.slice(`${INGEST.url}/reviews/`.length);
      const status = decisions.get(intent);
      return status ? Response.json({ status }) : new Response(null, { status: 404 });
    });
    return () => vi.unstubAllGlobals();
  });

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("queues the payment once and does not send it", async () => {
    const context = await testServerContext(runtime, { security });
    const first = await handleExecutePayment(context, request);
    await flush();
    expect(first.outcome).toBe("review_required");
    expect(first.next_step).toBe("wait_for_approval");
    expect(events).toHaveLength(1);
    expect(events[0]?.review?.intent_id).toBe(first.intent_id);

    decisions.set(first.intent_id, "pending");
    const again = await handleExecutePayment(context, request);
    await flush();
    expect(again.outcome).toBe("review_required");
    expect(events).toHaveLength(1);
    expect(broadcasts).toHaveLength(0);
  });

  it("sends exactly the approved payment", async () => {
    const context = await testServerContext(runtime, { security });
    const held = await handleExecutePayment(context, request);
    decisions.set(held.intent_id, "approved");

    const paid = await handleExecutePayment(context, request);
    expect(paid.outcome).toBe("settled");
    expect(broadcasts).toHaveLength(1);

    // A different reference is a different intent: the approval does not stretch to it.
    const other = await handleExecutePayment(context, { ...request, reference: "INV-OTHER" });
    expect(other.outcome).toBe("review_required");
    expect(broadcasts).toHaveLength(1);
  });

  it("denies a rejected payment for good", async () => {
    const context = await testServerContext(runtime, { security });
    const held = await handleExecutePayment(context, request);
    decisions.set(held.intent_id, "rejected");
    const result = await handleExecutePayment(context, request);
    expect(result).toMatchObject({ outcome: "denied", reason_code: "REVIEW_REJECTED" });
    expect(broadcasts).toHaveLength(0);
  });

  it("holds the payment when the dashboard cannot be reached", async () => {
    reachable = false;
    const context = await testServerContext(runtime, { security });
    const result = await handleExecutePayment(context, request);
    expect(result.outcome).toBe("review_required");
    expect(broadcasts).toHaveLength(0);
  });

  it("forwards a limit request and changes nothing", async () => {
    const context = await testServerContext(runtime, { security });
    const result = await handleRequestLimitIncrease(context, {
      reason: "vendor doubled the price",
      mint_ref: "SOL",
      amount: "5",
    });
    await flush();
    expect(result).toMatchObject({ requested: true, routed: true });
    expect(events[0]).toMatchObject({
      kind: "limit_increase_requested",
      request: { reason: "vendor doubled the price", requested_amount: "5" },
    });
    expect(broadcasts).toHaveLength(0);
  });

  it("refuses unknown fields in a limit request", async () => {
    const context = await testServerContext(runtime, { security });
    const result = await handleRequestLimitIncrease(context, {
      reason: "x",
      per_tx_max: "100",
    });
    expect(result.requested).toBe(false);
  });
});

describe("request_limit_increase without a dashboard", () => {
  it("says the request went nowhere", async () => {
    const runtime = { config: testConfig(), rpc: createRpc() } as unknown as McpRuntime;
    const result = await handleRequestLimitIncrease(await testServerContext(runtime), {
      reason: "need more",
    });
    expect(result).toMatchObject({ requested: false, routed: false });
  });
});
