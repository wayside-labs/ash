import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadVisitor, saveVisitor, fill, firstName } from "../../src/lib/visitor";

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, String(v)), removeItem: (k) => void m.delete(k),
    clear: () => m.clear(), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; },
  };
}

describe("visitor", () => {
  const g = globalThis as { localStorage?: Storage };
  beforeEach(() => { g.localStorage = memoryStorage(); });
  afterEach(() => { delete g.localStorage; });

  it("round-trips name and kind, and never an e-mail", () => {
    saveVisitor({ name: "Ana Souza", kind: "investor" });
    expect(loadVisitor()).toEqual({ name: "Ana Souza", kind: "investor" });
    expect(g.localStorage?.getItem("ash.visitor")).not.toContain("@");
  });
  it("keeps the lead ref when there is one, so 'let's talk' can point at the right lead", () => {
    const ref = "0b8e6f2a-3c1d-4e5f-9a7b-1c2d3e4f5a6b";
    saveVisitor({ name: "Ana", kind: "founder", ref });
    expect(loadVisitor()).toEqual({ name: "Ana", kind: "founder", ref });
    g.localStorage?.setItem("ash.visitor", JSON.stringify({ name: "Ana", kind: "founder", ref: 42 }));
    expect(loadVisitor()).toEqual({ name: "Ana", kind: "founder" });
  });
  it("ignores garbage and unknown kinds", () => {
    g.localStorage?.setItem("ash.visitor", "{not json");
    expect(loadVisitor()).toBeNull();
    g.localStorage?.setItem("ash.visitor", JSON.stringify({ name: "Ana", kind: "whale" }));
    expect(loadVisitor()).toBeNull();
  });
  it("survives a browser where storage throws", () => {
    g.localStorage = { ...memoryStorage(), getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(() => saveVisitor({ name: "Ana", kind: "other" })).not.toThrow();
    expect(loadVisitor()).toBeNull();
  });
  it("greets by first name and fills the template", () => {
    expect(firstName("  Ana Maria Souza ")).toBe("Ana");
    expect(fill("Hi, {name}.", "Ana")).toBe("Hi, Ana.");
    expect(fill("{name}’s treasury", "Ana")).toBe("Ana’s treasury");
  });
});
