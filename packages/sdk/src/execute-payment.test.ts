import type { Address } from "@solana/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AgentRailsError } from "./errors.js";
import { executePayment } from "./execute-payment.js";
import { resolvePaymentOutcome } from "./resolve.js";
import { sendPayment } from "./send-payment.js";
import { simulatePayment } from "./simulate.js";

// executePayment is a coordinator: simulate, send, and — only when the send path cannot
// say whether the transfer happened — resolve. Its collaborators are tested in their own
// files, so they are mocked here to leave the branch it owns, which is the one that
// decides whether an unlucky RPC call turns into a second payment.
vi.mock("./simulate.js", () => ({ simulatePayment: vi.fn() }));
vi.mock("./send-payment.js", () => ({ sendPayment: vi.fn() }));
vi.mock("./resolve.js", () => ({ resolvePaymentOutcome: vi.fn() }));

// A real address: findReceiptPda encodes it, so a placeholder fails base58 decoding.
const SESSION = "So11111111111111111111111111111111111111112" as Address;
const INTENT_ID = new Uint8Array(16).fill(7);
const SIMULATION = { unitsConsumed: 42_000n, logs: ["Program log: ok"] };

function input() {
  return {
    rpc: {} as never,
    transactionMessage: {} as never,
    lastValidBlockHeight: 1_000_000n,
    session: SESSION,
    intentId: INTENT_ID,
  };
}

function indeterminate(signature?: string) {
  return new AgentRailsError({
    reasonCode: "UNRESOLVED_OUTCOME",
    message: "confirmation timed out",
    outcome: "indeterminate",
    ...(signature ? { signature } : {}),
  });
}

beforeEach(() => {
  vi.mocked(simulatePayment).mockResolvedValue(SIMULATION as never);
  vi.mocked(sendPayment).mockResolvedValue({ signature: "sig-1" } as never);
  vi.mocked(resolvePaymentOutcome).mockReset();
});

describe("executePayment", () => {
  it("returns settled with the receipt when the send confirms", async () => {
    const result = await executePayment(input());
    expect(result.outcome).toBe("settled");
    expect(result.signature).toBe("sig-1");
    expect(result.simulation).toBe(SIMULATION);
    expect(result.receipt).toBeTypeOf("string");
    expect(resolvePaymentOutcome).not.toHaveBeenCalled();
  });

  it("simulates before sending, never after", async () => {
    await executePayment(input());
    expect(vi.mocked(simulatePayment).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(sendPayment).mock.invocationCallOrder[0] as number,
    );
  });

  // Only an indeterminate outcome is ambiguous. Everything else already knows whether
  // funds moved, and re-deriving it would risk turning a clean denial into a maybe.
  it("propagates a denial without trying to resolve it", async () => {
    const denial = new AgentRailsError({
      reasonCode: "EXCEEDS_PER_TX_MAX",
      message: "over the per-tx max",
      outcome: "denied",
    });
    vi.mocked(sendPayment).mockRejectedValue(denial);
    await expect(executePayment(input())).rejects.toBe(denial);
    expect(resolvePaymentOutcome).not.toHaveBeenCalled();
  });

  it("propagates a non-AgentRails failure untouched", async () => {
    const boom = new TypeError("rpc exploded");
    vi.mocked(sendPayment).mockRejectedValue(boom);
    await expect(executePayment(input())).rejects.toBe(boom);
    expect(resolvePaymentOutcome).not.toHaveBeenCalled();
  });

  // The property this module exists for. The transfer may already be on chain, so the
  // receipt — not the confirmation — is the authority on whether it happened.
  it("reports settled when resolution finds the receipt", async () => {
    vi.mocked(sendPayment).mockRejectedValue(indeterminate("sig-sent"));
    vi.mocked(resolvePaymentOutcome).mockResolvedValue({
      outcome: "settled",
      receipt: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
      intentId: "07".repeat(16),
      signature: "sig-resolved",
    } as never);

    const result = await executePayment(input());
    expect(result.outcome).toBe("settled");
    expect(result.signature).toBe("sig-resolved");
    expect(result.receipt).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  it("falls back to the send signature when resolution has none", async () => {
    vi.mocked(sendPayment).mockRejectedValue(indeterminate("sig-sent"));
    vi.mocked(resolvePaymentOutcome).mockResolvedValue({
      outcome: "settled",
      receipt: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
      intentId: "07".repeat(16),
    } as never);

    expect((await executePayment(input())).signature).toBe("sig-sent");
  });

  it("converts a resolved on-chain failure into a denial", async () => {
    vi.mocked(sendPayment).mockRejectedValue(indeterminate("sig-sent"));
    vi.mocked(resolvePaymentOutcome).mockResolvedValue({
      outcome: "denied",
      receipt: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
      intentId: "07".repeat(16),
      signature: "sig-sent",
      detail: "Transaction failed on-chain: {}",
    } as never);

    const error = (await executePayment(input()).catch((e: unknown) => e)) as AgentRailsError;
    expect(error).toBeInstanceOf(AgentRailsError);
    // A revert creates no receipt, so this intent id is free to be reused — which is only
    // safe to say because resolution saw the failure, not because the send timed out.
    expect(error.outcome).toBe("denied");
    expect(error.message).toBe("Transaction failed on-chain: {}");
    expect(error.receipt).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });

  // Still indeterminate after resolution: the caller must stop, not retry. The rethrow
  // keeps that outcome and only adds the identity needed to settle it later by hand.
  it("rethrows an unresolved outcome with the receipt attached", async () => {
    vi.mocked(sendPayment).mockRejectedValue(indeterminate("sig-sent"));
    vi.mocked(resolvePaymentOutcome).mockResolvedValue({
      outcome: "indeterminate",
      receipt: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as Address,
      intentId: "07".repeat(16),
    } as never);

    const error = (await executePayment(input()).catch((e: unknown) => e)) as AgentRailsError;
    expect(error.outcome).toBe("indeterminate");
    expect(error.intentId).toBe("07".repeat(16));
    expect(error.receipt).toBe("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
  });
});
