import { AGENT_RAILS_ERROR__PAUSED } from "@agent-rails/client";
import {
  appendTransactionMessageInstruction,
  createNoopSigner,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { describe, expect, it } from "vitest";
import { agentRailsErrorFromCode } from "./error-mapping.js";
import { isAgentRailsError } from "./errors.js";
import { simulatePayment } from "./simulate.js";

const FEE_PAYER = "11111111111111111111111111111116" as const;

function mockTransactionMessage() {
  const feePayer = createNoopSigner(FEE_PAYER);
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

describe("simulatePayment", () => {
  it("maps Anchor custom errors to AgentRailsError reason codes", () => {
    const error = agentRailsErrorFromCode(AGENT_RAILS_ERROR__PAUSED);
    expect(isAgentRailsError(error)).toBe(true);
    expect(error.reasonCode).toBe("TREASURY_PAUSED");
    expect(error.message).toContain("paused");
  });

  it("returns logs and compute units on successful simulation", async () => {
    const rpc = {
      simulateTransaction: () => ({
        send: async () => ({
          value: {
            err: null,
            logs: ["Program log: ok"],
            unitsConsumed: 42_000n,
          },
        }),
      }),
    };

    const result = await simulatePayment({
      rpc: rpc as never,
      transactionMessage: mockTransactionMessage(),
    });

    expect(result.err).toBeNull();
    expect(result.logs).toEqual(["Program log: ok"]);
    expect(result.unitsConsumed).toBe(42_000n);
  });

  it("throws AgentRailsError when simulation returns a custom program error", async () => {
    const rpc = {
      simulateTransaction: () => ({
        send: async () => ({
          value: {
            err: { InstructionError: [0, { Custom: AGENT_RAILS_ERROR__PAUSED }] },
            logs: [],
          },
        }),
      }),
    };

    await expect(
      simulatePayment({
        rpc: rpc as never,
        transactionMessage: mockTransactionMessage(),
      }),
    ).rejects.toMatchObject({
      reasonCode: "TREASURY_PAUSED",
    });
  });
});
