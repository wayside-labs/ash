import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  generateKeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { AgentRailsError } from "./errors.js";
import { sendPayment } from "./send-payment.js";

async function mockTransactionMessage() {
  const feePayer = await generateKeyPairSigner();
  return pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(feePayer, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: "EkSnNWid2cvwEVnVx9aBxgney8D4R9fKQ89KWkdHUjbv",
          lastValidBlockHeight: 1_000_000n,
        },
        message,
      ),
    (message) =>
      appendTransactionMessageInstruction(
        {
          programAddress: "4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS",
          accounts: [],
          data: new Uint8Array(16),
        },
        message,
      ),
  );
}

describe("sendPayment", () => {
  it("returns the transaction signature after send and confirmation", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const rpc = {
      sendTransaction: () => ({ send }),
      getBlockHeight: () => ({ send: async () => 999_999n }),
      getSignatureStatuses: () => ({
        send: async () => ({
          value: [{ err: null, confirmationStatus: "confirmed", confirmations: null }],
        }),
      }),
    };

    const result = await sendPayment({
      rpc: rpc as never,
      transactionMessage: await mockTransactionMessage(),
      lastValidBlockHeight: 1_000_000n,
    });

    expect(result.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/);
    expect(send).toHaveBeenCalledOnce();
  });

  it("throws AgentRailsError when confirmation times out", async () => {
    const rpc = {
      sendTransaction: () => ({ send: vi.fn().mockResolvedValue(undefined) }),
      getBlockHeight: () => ({ send: async () => 999_999n }),
      getSignatureStatuses: () => ({
        send: async () => ({ value: [null] }),
      }),
    };

    await expect(
      sendPayment({
        rpc: rpc as never,
        transactionMessage: await mockTransactionMessage(),
        lastValidBlockHeight: 1_000_000n,
        confirmTimeoutMs: 10,
      }),
    ).rejects.toBeInstanceOf(AgentRailsError);
  });

  it("throws AgentRailsError when the blockhash expires during confirmation", async () => {
    const rpc = {
      sendTransaction: () => ({ send: vi.fn().mockResolvedValue(undefined) }),
      getBlockHeight: () => ({ send: async () => 1_000_001n }),
      getSignatureStatuses: () => ({
        send: async () => ({ value: [null] }),
      }),
    };

    await expect(
      sendPayment({
        rpc: rpc as never,
        transactionMessage: await mockTransactionMessage(),
        lastValidBlockHeight: 1_000_000n,
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining("blockhash expired"),
    });
  });
});
