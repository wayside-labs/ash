import { AGENT_RAILS_PROGRAM_ADDRESS } from "@agent-rails/client";
import {
  appendTransactionMessageInstruction,
  blockhash,
  createTransactionMessage,
  generateKeyPairSigner,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { sendPayment } from "./send-payment.js";

async function mockTransactionMessage() {
  const feePayer = await generateKeyPairSigner();
  return pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(feePayer, message),
    (message) =>
      setTransactionMessageLifetimeUsingBlockhash(
        {
          blockhash: blockhash("EkSnNWid2cvwEVnVx9aBxgney8D4R9fKQ89KWkdHUjbv"),
          lastValidBlockHeight: 1_000_000n,
        },
        message,
      ),
    (message) =>
      appendTransactionMessageInstruction(
        {
          programAddress: AGENT_RAILS_PROGRAM_ADDRESS,
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

  it("reports a confirmation timeout as indeterminate, not as a denial", async () => {
    const rpc = {
      sendTransaction: () => ({ send: vi.fn().mockResolvedValue(undefined) }),
      getBlockHeight: () => ({ send: async () => 999_999n }),
      getSignatureStatuses: () => ({
        send: async () => ({ value: [null] }),
      }),
    };

    // The transaction is on the wire. "Denied" would invite a retry that pays twice.
    await expect(
      sendPayment({
        rpc: rpc as never,
        transactionMessage: await mockTransactionMessage(),
        lastValidBlockHeight: 1_000_000n,
        confirmTimeoutMs: 10,
      }),
    ).rejects.toMatchObject({
      outcome: "indeterminate",
      reasonCode: "UNRESOLVED_OUTCOME",
      signature: expect.stringMatching(/^[1-9A-HJ-NP-Za-km-z]{87,88}$/),
    });
  });

  it("reports an expired blockhash as indeterminate", async () => {
    const rpc = {
      sendTransaction: () => ({ send: vi.fn().mockResolvedValue(undefined) }),
      getBlockHeight: () => ({ send: async () => 1_000_001n }),
      getSignatureStatuses: () => ({
        send: async () => ({ value: [null] }),
      }),
    };

    // Probably dropped, but "probably" is not a basis for paying someone again.
    await expect(
      sendPayment({
        rpc: rpc as never,
        transactionMessage: await mockTransactionMessage(),
        lastValidBlockHeight: 1_000_000n,
      }),
    ).rejects.toMatchObject({ outcome: "indeterminate" });
  });

  it("reports an on-chain failure as a denial", async () => {
    const rpc = {
      sendTransaction: () => ({ send: vi.fn().mockResolvedValue(undefined) }),
      getBlockHeight: () => ({ send: async () => 999_999n }),
      getSignatureStatuses: () => ({
        send: async () => ({
          value: [
            { err: { InstructionError: [0, { Custom: 6000 }] }, confirmationStatus: "confirmed" },
          ],
        }),
      }),
    };

    // The transaction was included and reverted: nothing moved, no receipt, safe to change
    // something and try again.
    await expect(
      sendPayment({
        rpc: rpc as never,
        transactionMessage: await mockTransactionMessage(),
        lastValidBlockHeight: 1_000_000n,
      }),
    ).rejects.toMatchObject({ outcome: "denied" });
  });
});
