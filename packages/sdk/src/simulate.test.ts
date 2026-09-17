import { AGENT_RAILS_ERROR__PAUSED, AGENT_RAILS_PROGRAM_ADDRESS } from "@agent-rails/client";
import {
  address,
  appendTransactionMessageInstruction,
  blockhash,
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

const FEE_PAYER = address("11111111111111111111111111111116");

function mockTransactionMessage() {
  const feePayer = createNoopSigner(FEE_PAYER);
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

  /**
   * The regression this file previously missed.
   *
   * The mock below used to pass `Custom` as a plain number, so a guard that accepted only
   * numbers looked correct here while rejecting every denial a real validator sends. The
   * bigint form is what `simulateTransaction` actually returns, so it is what is asserted.
   */
  it("maps a bigint Custom code to its reason code, as a real RPC sends it", async () => {
    const rpc = {
      simulateTransaction: () => ({
        send: async () => ({
          value: {
            err: { InstructionError: [0n, { Custom: BigInt(AGENT_RAILS_ERROR__PAUSED) }] },
            logs: [],
          },
        }),
      }),
    };

    await expect(
      simulatePayment({ rpc: rpc as never, transactionMessage: mockTransactionMessage() }),
    ).rejects.toMatchObject({ reasonCode: "TREASURY_PAUSED" });
  });

  it("reports an unrecognised failure without crashing on its bigints", async () => {
    const rpc = {
      simulateTransaction: () => ({
        send: async () => ({
          value: { err: { InsufficientFundsForRent: { account_index: 3n } }, logs: [] },
        }),
      }),
    };

    await expect(
      simulatePayment({ rpc: rpc as never, transactionMessage: mockTransactionMessage() }),
    ).rejects.toMatchObject({
      reasonCode: "UNKNOWN_PROGRAM_ERROR",
      // Not "Do not know how to serialize a BigInt", which is what this used to say.
      message: 'Simulation failed: {"InsufficientFundsForRent":{"account_index":"3"}}',
    });
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
