import { describe, it, expect } from "vitest";
import { clamp, next, prev, fromHash, schedule, total, slideAt } from "../../src/lib/deck-model";

describe("deck-model", () => {
  it("clamps to the deck", () => {
    expect(clamp(-1, 12)).toBe(0);
    expect(clamp(99, 12)).toBe(11);
    expect(clamp(4, 12)).toBe(4);
  });
  it("stops at both ends instead of wrapping", () => {
    expect(next(3, 12)).toBe(4);
    expect(next(11, 12)).toBe(11);
    expect(prev(0, 12)).toBe(0);
    expect(prev(5, 12)).toBe(4);
  });
  it("reads a 1-based hash and ignores anything else", () => {
    expect(fromHash("#3", 12)).toBe(2);
    expect(fromHash("", 12)).toBe(0);
    expect(fromHash("#abc", 12)).toBe(0);
    expect(fromHash("#0", 12)).toBe(0);
    expect(fromHash("#40", 12)).toBe(11);
  });
  it("turns durations into start times", () => {
    expect(schedule([10, 20, 30])).toEqual([0, 10, 30]);
    expect(total([10, 20, 30])).toBe(60);
  });
  it("finds the slide playing at a given second", () => {
    expect(slideAt(0, [10, 20, 30])).toBe(0);
    expect(slideAt(10, [10, 20, 30])).toBe(1);
    expect(slideAt(59, [10, 20, 30])).toBe(2);
    expect(slideAt(999, [10, 20, 30])).toBe(2);
  });
});
