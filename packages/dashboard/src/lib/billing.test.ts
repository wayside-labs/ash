import { describe, expect, it } from "vitest";
import {
  chargeFor,
  costFromTokens,
  creditsToMicros,
  DEFAULT_MARKUP_BPS,
  formatMicros,
  markupMicros,
  parseMarkupBps,
  usdToMicros,
  worstCaseChargeMicros,
} from "./billing";

const SONNET = { promptMicros: 2, completionMicros: 10 };

describe("parseMarkupBps", () => {
  it("defaults to 20% when unset or blank", () => {
    expect(parseMarkupBps(undefined)).toBe(DEFAULT_MARKUP_BPS);
    expect(parseMarkupBps("  ")).toBe(2_000);
  });

  it("accepts an integer in range", () => {
    expect(parseMarkupBps("0")).toBe(0);
    expect(parseMarkupBps("1500")).toBe(1_500);
    expect(parseMarkupBps("10000")).toBe(10_000);
  });

  it("refuses what would silently mis-bill", () => {
    // 20000 is the classic "I meant 20%" typo: 200%, three times the model cost.
    for (const bad of ["20000", "-1", "12.5", "20%", "abc"]) {
      expect(() => parseMarkupBps(bad)).toThrow(RangeError);
    }
  });
});

describe("usdToMicros", () => {
  it("converts decimal strings exactly, without float drift", () => {
    expect(usdToMicros("0.25")).toBe(250_000);
    expect(usdToMicros("1")).toBe(1_000_000);
    expect(usdToMicros("0.1")).toBe(100_000);
    expect(usdToMicros("0.0000019")).toBe(1);
    expect(usdToMicros(undefined)).toBe(0);
    expect(usdToMicros("")).toBe(0);
  });

  it("rejects negatives and junk", () => {
    expect(() => usdToMicros("-1")).toThrow(RangeError);
    expect(() => usdToMicros("1e3")).toThrow(RangeError);
  });
});

describe("markup", () => {
  it("is 20% of the raw cost at the default", () => {
    expect(chargeFor(1_000_000, 2_000)).toEqual({
      rawCostMicros: 1_000_000,
      markupMicros: 200_000,
      totalMicros: 1_200_000,
    });
  });

  it("rounds the fee up, so a tiny turn is never fee-free", () => {
    expect(markupMicros(1, 2_000)).toBe(1);
    expect(markupMicros(4, 2_000)).toBe(1);
    expect(markupMicros(6, 2_000)).toBe(2);
  });

  it("charges zero on zero, and nothing extra at 0 bps", () => {
    expect(chargeFor(0, 2_000).totalMicros).toBe(0);
    expect(chargeFor(123, 0)).toEqual({ rawCostMicros: 123, markupMicros: 0, totalMicros: 123 });
  });

  it("refuses a negative or unsafe cost rather than computing with it", () => {
    expect(() => chargeFor(-1, 2_000)).toThrow(RangeError);
    expect(() => chargeFor(1.5, 2_000)).toThrow(RangeError);
    expect(() => chargeFor(Number.MAX_SAFE_INTEGER, 2_000)).toThrow(RangeError);
  });
});

describe("costs", () => {
  it("prices tokens at list", () => {
    expect(costFromTokens(SONNET, 1_000, 500)).toBe(2_000 + 5_000);
  });

  it("converts OpenRouter credits up to the next micro, ignoring float noise", () => {
    expect(creditsToMicros(0.0123)).toBe(12_300);
    expect(creditsToMicros(0.1 + 0.2)).toBe(300_000);
    expect(creditsToMicros(0.0000014)).toBe(2);
    expect(creditsToMicros(0)).toBe(0);
    expect(() => creditsToMicros(Number.NaN)).toThrow(RangeError);
    expect(() => creditsToMicros(-0.01)).toThrow(RangeError);
  });

  it("sizes the worst case at the full output ceiling plus a pessimistic prompt", () => {
    // 4000 chars → 2000 tokens × 2 + 8192 × 10 = 85 920 raw; +20% rounded up.
    expect(worstCaseChargeMicros(SONNET, 4_000, 8_192, 2_000)).toBe(85_920 + 17_184);
  });
});

describe("formatMicros", () => {
  it("shows cents normally and enough digits for a sub-cent charge", () => {
    expect(formatMicros(1_234_567, "en-US")).toBe("$1.23");
    expect(formatMicros(1_200, "en-US")).toBe("$0.0012");
    expect(formatMicros(-50_000, "en-US")).toBe("-$0.05");
    expect(formatMicros(0, "en-US")).toBe("$0.00");
  });
});
