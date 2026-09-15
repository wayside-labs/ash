import { describe, expect, it } from "vitest";
import { AmountConversionError, fromBaseUnits, toBaseUnits } from "./units.js";

describe("toBaseUnits", () => {
  it("scales by the mint's decimals, not the caller's assumption", () => {
    // The same text, two mints, a thousandfold difference. This is why `decimals` comes
    // from the treasury's MintConfig and never from a tool argument.
    expect(toBaseUnits("12.50", 6)).toBe(12_500_000n);
    expect(toBaseUnits("12.50", 9)).toBe(12_500_000_000n);
  });

  it("keeps full precision past the float boundary", () => {
    expect(toBaseUnits("9007199254.740993", 6)).toBe(9_007_199_254_740_993n);
  });

  it("refuses to round away precision the mint cannot hold", () => {
    expect(() => toBaseUnits("1.0000001", 6)).toThrow(AmountConversionError);
    expect(() => toBaseUnits("1.0000001", 6)).toThrow(/decimal places/);
  });

  it("accepts trailing zeros within the mint's precision", () => {
    expect(toBaseUnits("1.000000", 6)).toBe(1_000_000n);
    expect(toBaseUnits("1", 6)).toBe(1_000_000n);
  });

  it("rejects anything that is not a plain decimal", () => {
    for (const bad of ["", "-1", "1e6", "1,5", " 1", "0x10", "Infinity", "1."]) {
      expect(() => toBaseUnits(bad, 6)).toThrow(AmountConversionError);
    }
  });
});

describe("fromBaseUnits", () => {
  it("round-trips", () => {
    for (const [human, decimals] of [
      ["12.5", 6],
      ["0.000001", 6],
      ["1000000", 9],
      ["7", 0],
    ] as const) {
      expect(fromBaseUnits(toBaseUnits(human, decimals), decimals)).toBe(human);
    }
  });
});
