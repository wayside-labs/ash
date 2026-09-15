import { fetchMaybeIntentReceipt } from "@agent-rails/client";
import type { Address } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { precheckReceipt, resolvePaymentOutcome } from "./resolve.js";

vi.mock("@agent-rails/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@agent-rails/client")>()),
  fetchMaybeIntentReceipt: vi.fn(),
}));

const SESSION = "11111111111111111111111111111114" as Address;
const INTENT_ID = Uint8Array.from({ length: 16 }, (_, i) => i);
const SIGNATURE = "1".repeat(88);

function receiptExists(exists: boolean) {
  vi.mocked(fetchMaybeIntentReceipt).mockResolvedValue({
    exists,
    address: "11111111111111111111111111111118" as Address,
    ...(exists ? { data: { seq: 7n } } : {}),
  } as never);
}

function rpcWithStatus(status: unknown) {
  const getSignatureStatuses = vi.fn(() => ({ send: async () => ({ value: [status] }) }));
  return { rpc: { getSignatureStatuses } as never, getSignatureStatuses };
}

describe("resolvePaymentOutcome", () => {
  it("reports settled when the receipt exists", async () => {
    receiptExists(true);
    const { rpc } = rpcWithStatus(null);

    const resolution = await resolvePaymentOutcome({
      rpc,
      session: SESSION,
      intentId: INTENT_ID,
      signature: SIGNATURE,
    });

    expect(resolution.outcome).toBe("settled");
  });

  it("reports denied when the cluster has a failed transaction and no receipt", async () => {
    receiptExists(false);
    const { rpc } = rpcWithStatus({ err: { InstructionError: [0, { Custom: 6018 }] } });

    const resolution = await resolvePaymentOutcome({
      rpc,
      session: SESSION,
      intentId: INTENT_ID,
      signature: SIGNATURE,
      attempts: 1,
    });

    expect(resolution.outcome).toBe("denied");
  });

  it("stays indeterminate rather than assuming a missing receipt means no payment", async () => {
    receiptExists(false);
    const { rpc } = rpcWithStatus(null);

    const resolution = await resolvePaymentOutcome({
      rpc,
      session: SESSION,
      intentId: INTENT_ID,
      signature: SIGNATURE,
      attempts: 2,
      intervalMs: 1,
    });

    expect(resolution.outcome).toBe("indeterminate");
    expect(resolution.receipt).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  });

  it("searches transaction history, not just the node's recent cache", async () => {
    receiptExists(false);
    const { rpc, getSignatureStatuses } = rpcWithStatus(null);

    await resolvePaymentOutcome({
      rpc,
      session: SESSION,
      intentId: INTENT_ID,
      signature: SIGNATURE,
      attempts: 1,
    });

    // A transaction that landed while the client timed out has already fallen out of the
    // recent-status window, which is exactly the case this exists to catch.
    expect(getSignatureStatuses).toHaveBeenCalledWith([SIGNATURE], {
      searchTransactionHistory: true,
    });
  });
});

describe("precheckReceipt", () => {
  it("reports a settled payment before anything is built", async () => {
    receiptExists(true);

    const precheck = await precheckReceipt({
      rpc: {} as never,
      session: SESSION,
      intentId: INTENT_ID,
    });

    expect(precheck.settled).toBe(true);
  });

  it("reports an unsettled intent with its receipt address", async () => {
    receiptExists(false);

    const precheck = await precheckReceipt({
      rpc: {} as never,
      session: SESSION,
      intentId: INTENT_ID,
    });

    expect(precheck.settled).toBe(false);
    expect(precheck.intentId).toBe("000102030405060708090a0b0c0d0e0f");
  });
});
