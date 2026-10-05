import { describe, it, expect } from "vitest";
import { evaluate, apply, freshState, type Policy } from "../../src/lib/ceiling-model";

const policy: Policy = { perTxMax: 250, windowBudget: 1000, allowed: ["rpc-vendor", "inference"], paused: false };

describe("ceiling model", () => {
  it("settles a payment inside every rule", () => {
    expect(evaluate(policy, freshState(), { id: "a", to: "rpc-vendor", amount: 40 })).toBe("settled");
  });
  it("refuses over the per-payment ceiling", () => {
    expect(evaluate(policy, freshState(), { id: "b", to: "rpc-vendor", amount: 900 })).toBe("EXCEEDS_PER_TX_MAX");
  });
  it("refuses an unknown destination", () => {
    expect(evaluate(policy, freshState(), { id: "c", to: "unknown", amount: 10 })).toBe("DESTINATION_NOT_ALLOWED");
  });
  it("refuses a duplicate id and moves the balance once", () => {
    const s1 = apply(policy, freshState(), { id: "d", to: "inference", amount: 100 });
    expect(s1.verdict).toBe("settled");
    const s2 = apply(policy, s1.state, { id: "d", to: "inference", amount: 100 });
    expect(s2.verdict).toBe("DUPLICATE_INTENT");
    expect(s2.state.spentInWindow).toBe(100);
  });
  it("refuses when the window budget is exhausted", () => {
    let st = freshState();
    for (let i = 0; i < 4; i++) st = apply(policy, st, { id: `w${i}`, to: "rpc-vendor", amount: 250 }).state;
    expect(evaluate(policy, st, { id: "w9", to: "rpc-vendor", amount: 1 })).toBe("EXCEEDS_WINDOW");
  });
  it("refuses everything while paused", () => {
    expect(evaluate({ ...policy, paused: true }, freshState(), { id: "p", to: "rpc-vendor", amount: 1 })).toBe("TREASURY_PAUSED");
  });
  it("checks in program order: destination before duplicate before amount", () => {
    const st = apply(policy, freshState(), { id: "o", to: "rpc-vendor", amount: 10 }).state;
    expect(evaluate(policy, st, { id: "o", to: "unknown", amount: 9999 })).toBe("DESTINATION_NOT_ALLOWED");
    expect(evaluate(policy, st, { id: "o", to: "rpc-vendor", amount: 9999 })).toBe("DUPLICATE_INTENT");
  });
});
