import {
  calculateFeeBigint,
  FIXED_FEE_LAMPORTS,
  isWithdrawAmountSufficient,
  MIN_DEPOSIT_LAMPORTS,
  VARIABLE_FEE_DENOMINATOR,
  VARIABLE_FEE_NUMERATOR,
} from "@cloak.dev/sdk";
import { describe, expect, it } from "vitest";
import {
  EXIT_FEE_FIXED_LAMPORTS,
  EXIT_FEE_RATE_DENOMINATOR,
  EXIT_FEE_RATE_NUMERATOR,
  MIN_SHIELD_LAMPORTS,
} from "./constants.js";
import { exitFeeLamports, netAfterExitFee, zecMinOutput } from "./fees.js";

// These run against the real SDK on purpose: the approval card shows our number, and the relay
// charges theirs. If a Cloak release changes the fee, this is where it is noticed.
describe("exit fee parity with @cloak.dev/sdk", () => {
  it("uses the same constants", () => {
    expect(EXIT_FEE_FIXED_LAMPORTS).toBe(BigInt(FIXED_FEE_LAMPORTS));
    expect(EXIT_FEE_RATE_NUMERATOR).toBe(BigInt(VARIABLE_FEE_NUMERATOR));
    expect(EXIT_FEE_RATE_DENOMINATOR).toBe(BigInt(VARIABLE_FEE_DENOMINATOR));
    expect(MIN_SHIELD_LAMPORTS).toBe(BigInt(MIN_DEPOSIT_LAMPORTS));
  });

  it("agrees on the fee for round, odd and large amounts", () => {
    for (const gross of [
      1n,
      999n,
      10_000_000n,
      20_000_000n,
      33_333_333n,
      49_999_999n,
      50_000_000n,
      99_999_999n,
      1_000_000_000n,
      12_345_678_901n,
    ]) {
      expect(exitFeeLamports(gross), String(gross)).toBe(calculateFeeBigint(gross));
    }
  });

  it("agrees across a spread of pseudo-random amounts", () => {
    let seed = 12345n;
    for (let i = 0; i < 300; i++) {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) & ((1n << 64n) - 1n);
      const gross = (seed % 100_000_000_000n) + 1n;
      expect(exitFeeLamports(gross)).toBe(calculateFeeBigint(gross));
    }
  });

  it("calls a payout viable exactly when the SDK does", () => {
    for (const gross of [1n, 5_000_000n, 5_000_001n, 5_015_000n, 10_000_000n, 20_000_000n]) {
      expect(netAfterExitFee(gross) > 0n, String(gross)).toBe(isWithdrawAmountSufficient(gross));
    }
  });
});

describe("the demo numbers", () => {
  it("charges 5,060,000 lamports on 0.02 SOL and leaves 14,940,000", () => {
    expect(exitFeeLamports(20_000_000n)).toBe(5_060_000n);
    expect(netAfterExitFee(20_000_000n)).toBe(14_940_000n);
  });

  it("floors the variable part, like the SDK", () => {
    expect(exitFeeLamports(333n)).toBe(5_000_000n); // 333 * 3 / 1000 = 0.999 -> 0
    expect(exitFeeLamports(334n)).toBe(5_000_001n);
  });
});

describe("zecMinOutput", () => {
  it("takes the slippage bound off the quote", () => {
    expect(zecMinOutput(183_000n)).toBe(179_340n); // -2%
    expect(zecMinOutput(100n)).toBe(98n);
  });

  it("never exceeds the quote and never goes negative", () => {
    for (const quote of [1n, 49n, 50n, 51n, 10_000n, 10n ** 12n]) {
      const min = zecMinOutput(quote);
      expect(min <= quote).toBe(true);
      expect(min >= 0n).toBe(true);
    }
  });
});
