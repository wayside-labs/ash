import { describe, expect, it } from "vitest";
import { fundingLine, shortfall } from "./funding.js";

describe("shortfall", () => {
  it("returns zero when already at target", () => {
    expect(shortfall(100n, 100n)).toBe(0n);
    expect(shortfall(100n, 150n)).toBe(0n);
  });

  it("returns the gap to target", () => {
    expect(shortfall(100n, 40n)).toBe(60n);
  });

  // Funding is a top-up, never a transfer: a vault that is already over target must not
  // produce a negative amount, which would underflow into a u64 the size of the chain.
  it("never goes negative", () => {
    expect(shortfall(0n, 1_000n)).toBe(0n);
  });

  it("treats an empty holding as the whole target", () => {
    expect(shortfall(1_000n, 0n)).toBe(1_000n);
  });
});

describe("fundingLine", () => {
  const format = (value: bigint) => `${value} lamports`;

  it("says nothing is moving when the shortfall is zero", () => {
    expect(fundingLine(100n, 150n, 0n, format)).toBe(
      "150 lamports (already at or above 100 lamports)",
    );
  });

  it("shows the top-up as held -> target", () => {
    expect(fundingLine(100n, 40n, 60n, format)).toBe(
      "40 lamports -> 100 lamports (sending 60 lamports)",
    );
  });
});
