import { describe, expect, it } from "vitest";
import { balanceState } from "./shell";

describe("balanceState", () => {
  it("is off when billing is disabled, whatever the number", () => {
    expect(balanceState({ enabled: false, balanceMicros: 5 })).toBe("off");
  });

  it("separates empty, negative and funded", () => {
    expect(balanceState({ enabled: true, balanceMicros: 0 })).toBe("empty");
    expect(balanceState({ enabled: true, balanceMicros: -1 })).toBe("negative");
    expect(balanceState({ enabled: true, balanceMicros: 1 })).toBe("funded");
  });
});
