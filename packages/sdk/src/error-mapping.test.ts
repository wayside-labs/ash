import { REASON_CODES, SDK_REASON_CODES } from "@agent-rails/contract";
import { SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, SolanaError } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  agentRailsErrorFromCode,
  reasonCodeFromProgramError,
  toAgentRailsError,
} from "./error-mapping.js";
import { AgentRailsError } from "./errors.js";

/** An Anchor custom error as Kit surfaces it from a failed instruction. */
function customProgramError(code: unknown): SolanaError {
  return new SolanaError(SOLANA_ERROR__INSTRUCTION_ERROR__CUSTOM, {
    code: code as number,
    index: 0,
  });
}

describe("reasonCodeFromProgramError", () => {
  // error-mapping.ts builds its table from the generated client's constants; contract's
  // REASON_CODES is hand-written. Nothing but this test holds the two together, and a
  // program error added by codegen without a matching contract entry would otherwise
  // surface as UNKNOWN_PROGRAM_ERROR at runtime rather than failing a build.
  it.each(Object.entries(REASON_CODES))("maps program error %s to %s", (code, reason) => {
    expect(reasonCodeFromProgramError(Number(code))).toBe(reason);
  });

  it("covers every code the contract declares, with no gaps in the range", () => {
    const codes = Object.keys(REASON_CODES).map(Number);
    const lowest = Math.min(...codes);
    const highest = Math.max(...codes);
    expect(codes).toHaveLength(highest - lowest + 1);
  });

  // The property this module exists to guarantee. DUPLICATE_INTENT means "a receipt
  // exists, the payment settled" — reporting an unrecognized failure as a completed
  // payment is the one mapping mistake that loses money rather than a request.
  it.each([0, 1, 6042, 6100, 9999, -1, Number.MAX_SAFE_INTEGER])(
    "maps unrecognized code %i to UNKNOWN_PROGRAM_ERROR, never DUPLICATE_INTENT",
    (code) => {
      expect(reasonCodeFromProgramError(code)).toBe(SDK_REASON_CODES.UNKNOWN_PROGRAM_ERROR);
      expect(reasonCodeFromProgramError(code)).not.toBe(SDK_REASON_CODES.DUPLICATE_INTENT);
    },
  );
});

describe("agentRailsErrorFromCode", () => {
  it("reports a program revert as a denial, not an indeterminate outcome", () => {
    const error = agentRailsErrorFromCode(6000);
    expect(error.reasonCode).toBe("TREASURY_PAUSED");
    // A program error means the transaction executed and reverted: nothing moved. Any
    // other outcome here would invite a caller to treat a clean denial as a maybe-sent.
    expect(error.outcome).toBe("denied");
    expect(error.source).toBe("program");
  });

  it("keeps the cause for the operator's record", () => {
    const cause = customProgramError(6001);
    expect(agentRailsErrorFromCode(6001, cause).cause).toBe(cause);
  });

  it("falls back to the reason code when the client has no message for it", () => {
    const error = agentRailsErrorFromCode(9999);
    expect(error.reasonCode).toBe("UNKNOWN_PROGRAM_ERROR");
    expect(error.message).toBe("UNKNOWN_PROGRAM_ERROR");
  });
});

describe("toAgentRailsError", () => {
  it("returns an AgentRailsError unchanged", () => {
    const original = new AgentRailsError({
      reasonCode: "SESSION_BUSY",
      message: "already in flight",
      outcome: "denied",
    });
    // Identity, not a copy: layers above attach intent id and signature to the instance
    // they hold, and re-wrapping here would silently drop that context.
    expect(toAgentRailsError(original)).toBe(original);
  });

  it("unwraps a Kit custom instruction error to its program reason", () => {
    const error = toAgentRailsError(customProgramError(6018));
    expect(error.reasonCode).toBe("EXCEEDS_PER_TX_MAX");
    expect(error.source).toBe("program");
    expect(error.outcome).toBe("denied");
  });

  it("treats a custom error with a non-numeric code as a non-program failure", () => {
    // A SolanaError is still an Error, so this must land on the simulation branch rather
    // than coercing a malformed code into a program decision it never made.
    const error = toAgentRailsError(customProgramError("6018"));
    expect(error.reasonCode).toBe("UNKNOWN_PROGRAM_ERROR");
    expect(error.source).toBe("simulation");
  });

  it("attributes a plain Error to simulation and keeps its message", () => {
    const cause = new Error("rpc unreachable");
    const error = toAgentRailsError(cause);
    expect(error.reasonCode).toBe("UNKNOWN_PROGRAM_ERROR");
    expect(error.source).toBe("simulation");
    expect(error.message).toBe("rpc unreachable");
    expect(error.cause).toBe(cause);
  });

  it.each([
    ["a string", "boom"],
    ["undefined", undefined],
    ["an object", { code: 6000 }],
  ])("falls back to a fixed message for %s", (_label, thrown) => {
    const error = toAgentRailsError(thrown);
    expect(error.reasonCode).toBe("UNKNOWN_PROGRAM_ERROR");
    expect(error.message).toBe("Payment simulation failed");
    expect(error.outcome).toBe("denied");
    expect(error.cause).toBe(thrown);
  });
});
