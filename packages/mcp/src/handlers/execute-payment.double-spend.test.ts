/**
 * Regression: a payment whose confirmation never resolves must not settle twice.
 *
 * The on-chain `IntentReceipt` makes a retried intent fail at account creation (ADR-004),
 * but that only bites when the retry carries the *same* `intent_id`. This drives the real
 * handler against an RPC that accepts the transaction and then never confirms it — the
 * ordinary behaviour of a lagging node — and asserts the three properties that keep the
 * receipt guarantee reachable:
 *
 *   1. the response carries `intent_id` even when the outcome is not a success, so the
 *      caller can resolve it with `agent_rails_get_payment_status`;
 *   2. an unresolved send is not reported as a denial, because a denial invites a retry;
 *   3. a retry of the same payment derives the same receipt PDA, so the program refuses it.
 *
 * Before the fix all three failed: the response was `{ allowed: false, reason_code:
 * "UNAUTHORIZED" }` with no id, and the retry drew a fresh random `intent_id` and paid
 * again with no adversary involved.
 */

import {
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from "@solana/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpRuntime } from "../config.js";
import {
  TEST_BLOCKHASH,
  TEST_LAST_VALID_BLOCK_HEIGHT,
  TEST_SESSION,
  testConfig,
  testServerContext,
} from "../testing.js";
import { handleExecutePayment } from "./execute-payment.js";

// Liveness reads real accounts; this test is about retry semantics, not account decoding.
vi.mock("../bound-context.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../bound-context.js")>()),
  assertSessionLive: vi.fn(async () => {}),
}));

/** The agent's request. Identical across the retry, because it is the same payment. */
const paymentRequest = {
  destination_ref: "acme-hosting",
  amount: "1.5",
  mint_ref: "SOL",
  reference: "INV-2026-0041",
};

/**
 * An RPC that accepts the transaction and then never produces a status for it.
 *
 * The block height is already past the blockhash lifetime, which makes this run in
 * milliseconds rather than the confirmation timeout. Both exits are the same class of
 * event: the send succeeded and the outcome is unknown.
 */
function createStallingRpc(broadcasts: string[]) {
  return {
    getAccountInfo: () => ({ send: async () => ({ value: null }) }),
    getLatestBlockhash: () => ({
      // The RPC envelope, as a node actually answers it. A fake that returns the bare
      // value hides a destructuring bug that only a live validator will find.
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
    sendTransaction: (wireTransaction: string) => ({
      send: async () => {
        broadcasts.push(wireTransaction);
        return "1".repeat(88);
      },
    }),
    getBlockHeight: () => ({ send: async () => TEST_LAST_VALID_BLOCK_HEIGHT + 1n }),
    getSignatureStatuses: () => ({ send: async () => ({ value: [null] }) }),
  };
}

/** `intent_id` is the 16 bytes following the 8-byte Anchor discriminator. */
function intentIdFromWireTransaction(wireTransaction: string): string {
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(wireTransaction));
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
  // v1 compiled messages carry a different instruction payload and no `instructions` array;
  // the SDK builds version 0, so anything else means the fixture drifted.
  if (message.version === 1) {
    throw new Error(`expected a version 0 message, got v${message.version}`);
  }
  const instruction = message.instructions[0];
  if (!instruction?.data) {
    throw new Error("transaction carried no instruction data");
  }
  return Array.from(Uint8Array.from(instruction.data).slice(8, 24), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

describe("execute_payment under an unconfirmed send", () => {
  let broadcasts: string[];
  let runtime: McpRuntime;

  beforeEach(() => {
    broadcasts = [];
    runtime = {
      config: testConfig(),
      rpc: createStallingRpc(broadcasts),
    } as unknown as McpRuntime;
  });

  it("reports the intent id and receipt so the caller can resolve the outcome", async () => {
    const context = await testServerContext(runtime);

    const result = await handleExecutePayment(context, paymentRequest);

    // The transaction reached the network: the money may already be gone.
    expect(broadcasts).toHaveLength(1);
    expect(result.intent_id).toMatch(/^[0-9a-f]{32}$/);
    expect(result.receipt).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("does not report an unconfirmed send as a denial", async () => {
    const context = await testServerContext(runtime);

    const result = await handleExecutePayment(context, paymentRequest);

    // A denial is safe to retry; an unknown outcome is not. They must not share a shape.
    expect(result.outcome).toBe("indeterminate");
    expect(result.next_step).toContain("agent_rails_get_payment_status");
  });

  it("refuses to pay again until the outcome is resolved", async () => {
    const context = await testServerContext(runtime);

    await handleExecutePayment(context, paymentRequest);
    const retry = await handleExecutePayment(context, paymentRequest);

    expect(retry.outcome).toBe("denied");
    expect(retry.reason_code).toBe("SESSION_QUIESCED");
    // The decisive assertion: nothing else went to the network.
    expect(broadcasts).toHaveLength(1);
  });

  it("derives the same receipt for a retry of the same payment", async () => {
    // A fresh context means a fresh governor, so the quiesce is not what stops the second
    // payment here. This is the on-chain guarantee: same payment, same intent id, same
    // receipt PDA, and `IntentReceipt` init fails before any transfer.
    const first = await testServerContext(runtime);
    const second = await testServerContext(runtime, { bound: first.bound });

    const firstResult = await handleExecutePayment(first, paymentRequest);
    const secondResult = await handleExecutePayment(second, paymentRequest);

    expect(broadcasts).toHaveLength(2);
    const ids = broadcasts.map(intentIdFromWireTransaction);
    expect(new Set(ids).size).toBe(1);
    expect(ids[0]).toBe(firstResult.intent_id);
    expect(secondResult.intent_id).toBe(firstResult.intent_id);
  });

  it("uses a different intent for a genuinely different payment", async () => {
    const context = await testServerContext(runtime);
    const other = await testServerContext(runtime, { bound: context.bound });

    const a = await handleExecutePayment(context, paymentRequest);
    const b = await handleExecutePayment(other, {
      ...paymentRequest,
      reference: "INV-2026-0042",
    });

    // Idempotency must not become a payment ceiling: a different invoice is a different
    // payment, bounded by the window and lifetime limits rather than by the receipt.
    expect(b.intent_id).not.toBe(a.intent_id);
    expect(TEST_SESSION).toBe(context.bound.session);
  });
});
