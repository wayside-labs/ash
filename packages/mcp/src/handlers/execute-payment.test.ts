import { NATIVE_MINT } from "@agent-rails/contract";
import { AgentRailsError } from "@agent-rails/sdk";
import { createNoopSigner } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import type { McpRuntime } from "../config.js";
import { handleExecutePayment } from "./execute-payment.js";

const TREASURY = "11111111111111111111111111111112";
const POLICY = "11111111111111111111111111111113";
const SESSION = "11111111111111111111111111111114";
const DESTINATION = "11111111111111111111111111111115";
const FEE_PAYER = "11111111111111111111111111111116";
const SESSION_KEY = "11111111111111111111111111111117";

const signers = {
  feePayer: createNoopSigner(FEE_PAYER),
  sessionKey: createNoopSigner(SESSION_KEY),
};

const baseInput = {
  mint: NATIVE_MINT,
  destination: DESTINATION,
  amount: "1000",
  expires_at: 1_900_000_000,
  treasury: TREASURY,
  policy: POLICY,
  session: SESSION,
};

function mockRuntime(simulateResult: { err: null; logs: string[]; unitsConsumed: bigint }) {
  return {
    config: {
      rpcUrl: "http://localhost:8899",
      signerKeypairPath: "/tmp/session.json",
    },
    rpc: {
      getLatestBlockhash: () => ({
        send: async () => ({
          blockhash: "EkSnNWid2cvwEVnVx9aBxgney8D4R9fKQ89KWkdHUjbv",
          lastValidBlockHeight: 1_000_000n,
        }),
      }),
      simulateTransaction: () => ({
        send: async () => ({ value: simulateResult }),
      }),
    },
  } as McpRuntime;
}

describe("handleExecutePayment", () => {
  it("returns simulation result for a valid SOL payment", async () => {
    const runtime = mockRuntime({
      err: null,
      logs: ["Program log: ok"],
      unitsConsumed: 32_000n,
    });

    const result = await handleExecutePayment(runtime, signers, baseInput);

    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.path).toBe("sol");
      expect(result.intent_id).toHaveLength(32);
      expect(result.simulation.units_consumed).toBe("32000");
    }
  });

  it("returns reason_code when simulation denies the payment", async () => {
    const runtime = mockRuntime({
      err: { InstructionError: [0, { Custom: 6000 }] },
      logs: [],
      unitsConsumed: 0n,
    });

    const result = await handleExecutePayment(runtime, signers, baseInput);

    expect(result).toEqual({
      allowed: false,
      reason_code: "TREASURY_PAUSED",
      message: expect.stringContaining("paused"),
    });
  });

  it("re-throws non-AgentRails errors", async () => {
    const runtime = {
      config: {
        rpcUrl: "http://localhost:8899",
        signerKeypairPath: "/tmp/session.json",
      },
      rpc: {
        getLatestBlockhash: () => ({
          send: vi.fn().mockRejectedValue(new Error("rpc down")),
        }),
      },
    } as McpRuntime;

    await expect(handleExecutePayment(runtime, signers, baseInput)).rejects.toThrow("rpc down");
  });
});

describe("AgentRailsError mapping", () => {
  it("preserves reason codes for MCP responses", () => {
    const error = new AgentRailsError({
      reasonCode: "EXCEEDS_PER_TX_MAX",
      message: "Amount exceeds the per-transaction maximum",
    });
    expect(error.reasonCode).toBe("EXCEEDS_PER_TX_MAX");
  });
});
