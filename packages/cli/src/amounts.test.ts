import { describe, expect, it } from "vitest";
import { formatSol, parsePositiveInt, parseSol } from "./amounts.js";
import { CliError } from "./errors.js";

describe("parseSol", () => {
  it("converts whole and fractional SOL to lamports", () => {
    expect(parseSol("1", "--deposit")).toBe(1_000_000_000n);
    expect(parseSol("0.5", "--deposit")).toBe(500_000_000n);
    expect(parseSol("0.000000001", "--deposit")).toBe(1n);
  });

  /** The reason this goes through `toBaseUnits`: 0.1 * 1e9 is not 100000000 in floating point. */
  it("does not accumulate floating-point error", () => {
    expect(parseSol("0.1", "--per-tx")).toBe(100_000_000n);
    expect(parseSol("2.675", "--per-tx")).toBe(2_675_000_000n);
  });

  it.each(["", "-1", "1e9", "abc", "1.2.3", " "])("rejects %o", (value) => {
    expect(() => parseSol(value, "--deposit")).toThrow(CliError);
  });

  it("rejects zero, which the policy engine treats as InvalidLimit", () => {
    expect(() => parseSol("0", "--per-tx")).toThrow(CliError);
    expect(() => parseSol("0.0", "--per-tx")).toThrow(CliError);
  });
});

describe("parsePositiveInt", () => {
  it("accepts a positive integer", () => {
    expect(parsePositiveInt("24", "--session-ttl")).toBe(24);
  });

  it.each(["0", "-3", "1.5", "abc"])("rejects %o", (value) => {
    expect(() => parsePositiveInt(value, "--session-ttl")).toThrow(CliError);
  });
});

describe("formatSol", () => {
  it("trims trailing zeros but keeps significant digits", () => {
    expect(formatSol(1_000_000_000n)).toBe("1 SOL");
    expect(formatSol(500_000_000n)).toBe("0.5 SOL");
    expect(formatSol(1n)).toBe("0.000000001 SOL");
    expect(formatSol(0n)).toBe("0 SOL");
  });
});
