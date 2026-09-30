import { describe, expect, it } from "vitest";
import { balanceState, isSimpleRoute, parseShellMode } from "./shell";

describe("parseShellMode", () => {
  it("defaults to the simple shell", () => {
    expect(parseShellMode(undefined)).toBe("simple");
    expect(parseShellMode("")).toBe("simple");
    expect(parseShellMode("advanced")).toBe("simple");
  });

  it("accepts operator in any case", () => {
    expect(parseShellMode(" Operator ")).toBe("operator");
  });
});

describe("isSimpleRoute", () => {
  it("treats / as simple only in the simple shell", () => {
    expect(isSimpleRoute("/", "simple")).toBe(true);
    expect(isSimpleRoute("/", "operator")).toBe(false);
  });

  it("always treats the balance page as simple", () => {
    expect(isSimpleRoute("/balance", "operator")).toBe(true);
    expect(isSimpleRoute("/balance/history", "simple")).toBe(true);
  });

  it("treats the account page as simple in either shell", () => {
    expect(isSimpleRoute("/account", "simple")).toBe(true);
    expect(isSimpleRoute("/account", "operator")).toBe(true);
    expect(isSimpleRoute("/accounts", "simple")).toBe(false);
  });

  it("never treats an operator route as simple", () => {
    for (const path of ["/advanced", "/treasury", "/limits", "/wallets", "/balances"]) {
      expect(isSimpleRoute(path, "simple")).toBe(false);
    }
  });
});

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
