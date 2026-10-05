import { describe, it, expect } from "vitest";
import { initialFlow, step, rng, type FlowState } from "../../src/lib/flow-model";

// A random source that returns a fixed script, so each rule can be pinned down exactly.
const script = (...xs: number[]) => { let k = 0; return () => xs[k++ % xs.length] ?? 0; };

describe("flow-model", () => {
  it("starts from the demo store: one vault, four agents, one paused", () => {
    const s = initialFlow();
    expect(s.vault).toBe(2450);
    expect(s.ceiling).toBe(500);
    expect(s.agents.map((a) => a.id)).toEqual(["ana", "joao", "maria", "carlos"]);
    expect(s.agents.find((a) => a.id === "carlos")?.status).toBe("paused");
  });

  it("a payment inside the limit settles and moves the money everywhere at once", () => {
    const s0 = initialFlow();
    // 0.9 → not a handoff; 0 → first payment edge (joão → customers); 0 → smallest amount (2.00)
    const { state, event } = step(s0, script(0.9, 0, 0));
    expect(event).toEqual({ kind: "settled", from: "joao", to: "customers", amount: 2 });
    const j0 = s0.agents.find((a) => a.id === "joao")!;
    const j1 = state.agents.find((a) => a.id === "joao")!;
    expect(j1.spent).toBe(j0.spent + 2);
    expect(j1.balance).toBe(j0.balance - 2);
    expect(state.vault).toBe(s0.vault - 2);
    expect(state.payeeToday.customers).toBe(2);
    expect(state.spentToday).toBe(s0.spentToday + 2);
  });

  it("a payment over the agent's limit is denied and nothing moves", () => {
    const s0: FlowState = initialFlow();
    const joao = s0.agents.find((a) => a.id === "joao")!;
    joao.spent = joao.limit - 1;
    const { state, event } = step(s0, script(0.9, 0, 0.99));
    expect(event.kind).toBe("denied");
    expect(state.vault).toBe(s0.vault);
    expect(state.deniedToday).toBe(s0.deniedToday + 1);
  });

  it("a paused agent is blocked before any limit is checked", () => {
    const s0 = initialFlow();
    const edges = s0.agents.flatMap((a) => a.pays.map((p) => [a.id, p]));
    const k = edges.findIndex(([a]) => a === "carlos");
    const { event } = step(s0, script(0.9, (k + 0.5) / edges.length, 0));
    expect(event).toMatchObject({ kind: "blocked", from: "carlos", to: "carriers", amount: 0 });
  });

  it("hands work between agents without touching money", () => {
    const s0 = initialFlow();
    const { state, event } = step(s0, script(0.1, 0));
    expect(event.kind).toBe("handoff");
    expect(state.vault).toBe(s0.vault);
  });

  it("starts a new day once enough has happened, so the demo never freezes on denials", () => {
    let s = initialFlow();
    const r = rng(7);
    for (let k = 0; k < 500; k++) s = step(s, r).state;
    expect(s.vault).toBeGreaterThan(0);
    expect(s.agents.every((a) => a.spent <= a.limit)).toBe(true);
  });
});
