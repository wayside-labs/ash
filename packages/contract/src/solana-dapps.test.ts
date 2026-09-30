import { describe, expect, it } from "vitest";
import { getSolanaDapp, SOLANA_DAPPS } from "./solana-dapps.js";

describe("solana-dapps", () => {
  it("includes jupiter as live integration", () => {
    const jup = getSolanaDapp("jupiter");
    expect(jup?.integration.status).toBe("live");
    expect(jup?.programIds.length).toBeGreaterThan(0);
  });

  it("lists raydium and orca for routing context", () => {
    const ids = new Set(SOLANA_DAPPS.map((d) => d.id));
    expect(ids.has("raydium")).toBe(true);
    expect(ids.has("orca")).toBe(true);
  });
});
