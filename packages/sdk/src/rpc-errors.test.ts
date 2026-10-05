import { ASH_ERROR__EXCEEDS_PER_TX_MAX, ASH_ERROR__PAUSED } from "@ash/client";
import { describe, expect, it } from "vitest";
import {
  ashErrorFromCode,
  customCodeFromTransactionError,
  stringifyRpcError,
} from "./error-mapping.js";

/**
 * The exact payload a validator returns, captured from a surfnet.
 *
 * Both the instruction index and the error code arrive as bigints, because Kit upcasts
 * every integer in an RPC response that is not on its numeric allowlist. The previous
 * tests here mocked `Custom` as a plain number, which is precisely why a guard that
 * rejected every real denial passed CI for as long as it did.
 */
const REAL_RPC_ERROR = { InstructionError: [0n, { Custom: 101n }] };

describe("customCodeFromTransactionError", () => {
  it("reads a bigint Custom code, as the network actually sends it", () => {
    expect(customCodeFromTransactionError(REAL_RPC_ERROR)).toBe(101);
  });

  it("still reads a plain number, for litesvm and hand-built fixtures", () => {
    expect(customCodeFromTransactionError({ InstructionError: [0, { Custom: 6001 }] })).toBe(6001);
  });

  it("maps a real program denial to its reason code rather than UNKNOWN_PROGRAM_ERROR", () => {
    const code = customCodeFromTransactionError({
      InstructionError: [0n, { Custom: BigInt(ASH_ERROR__EXCEEDS_PER_TX_MAX) }],
    });
    expect(code).toBeDefined();
    const error = ashErrorFromCode(code as number);
    expect(error.reasonCode).toBe("EXCEEDS_PER_TX_MAX");
    expect(error.reasonCode).not.toBe("UNKNOWN_PROGRAM_ERROR");
  });

  it("maps a paused treasury through the bigint path", () => {
    const code = customCodeFromTransactionError({
      InstructionError: [0n, { Custom: BigInt(ASH_ERROR__PAUSED) }],
    });
    expect(ashErrorFromCode(code as number).reasonCode).toBe("TREASURY_PAUSED");
  });

  it.each([
    ["a non-Custom instruction error", { InstructionError: [0n, "PrivilegeEscalation"] }],
    ["a bare string error", "AccountNotFound"],
    ["a malformed tuple", { InstructionError: [0n] }],
    ["null", null],
    ["a negative code", { InstructionError: [0n, { Custom: -1n }] }],
    ["a code beyond u32", { InstructionError: [0n, { Custom: 4_294_967_296n }] }],
  ])("returns undefined for %s", (_label, err) => {
    expect(customCodeFromTransactionError(err)).toBeUndefined();
  });
});

describe("stringifyRpcError", () => {
  /** Plain JSON.stringify throws on this exact object. That was the reported bug. */
  it("serialises a payload containing bigints instead of throwing", () => {
    expect(() => JSON.stringify(REAL_RPC_ERROR)).toThrow(TypeError);
    // Bigints render as quoted digits: exact, and unambiguous to whoever reads the message.
    expect(stringifyRpcError(REAL_RPC_ERROR)).toBe('{"InstructionError":["0",{"Custom":"101"}]}');
  });

  it("renders bigints as digits, not as an opaque object", () => {
    expect(stringifyRpcError({ units: 12_345n })).toBe('{"units":"12345"}');
  });

  it("falls back to a string rather than throwing on a circular payload", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => stringifyRpcError(circular)).not.toThrow();
  });

  it("never returns undefined", () => {
    expect(typeof stringifyRpcError(undefined)).toBe("string");
  });
});
