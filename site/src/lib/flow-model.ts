// The simulated store behind the "see it run" map (site) and the flow slides (pitch). Ported from
// the Claude Design workflow panel (docs/product in agent-rails), but pure and seedable so tests can
// pin each rule. The order of checks mirrors the program's: paused before limits, and a denied
// payment moves nothing.
export type AgentStatus = "active" | "paused" | "routes";
export interface FlowAgent { id: string; limit: number; spent: number; balance: number; status: AgentStatus; pays: string[] }
export interface Handoff { from: string; to: string; label: string }
export interface FlowState {
  day: number; events: number; vault: number; ceiling: number; spentToday: number; deniedToday: number;
  agents: FlowAgent[]; handoffs: Handoff[]; payeeToday: Record<string, number>;
}
export type FlowEvent =
  | { kind: "settled" | "denied" | "blocked"; from: string; to: string; amount: number }
  | { kind: "handoff"; from: string; to: string; label: string };

export const PAYEES = ["customers", "marketing", "openai", "vendors", "carriers"] as const;
const DAY_EVENTS = 40;
const cents = (x: number) => Math.round(x * 100) / 100;

export function initialFlow(day = 1): FlowState {
  return {
    day, events: 0, vault: 2450, ceiling: 500, spentToday: 45, deniedToday: 0,
    agents: [
      { id: "ana", limit: 0, spent: 0, balance: 0, status: "routes", pays: [] },
      { id: "joao", limit: 80, spent: 25, balance: 150, status: "active", pays: ["customers", "marketing"] },
      { id: "maria", limit: 50, spent: 12, balance: 200, status: "active", pays: ["openai", "vendors"] },
      { id: "carlos", limit: 30, spent: 8, balance: 75, status: "paused", pays: ["carriers"] },
    ],
    handoffs: [
      { from: "ana", to: "joao", label: "lead" },
      { from: "ana", to: "maria", label: "refund" },
      { from: "maria", to: "carlos", label: "shipment" },
    ],
    payeeToday: Object.fromEntries(PAYEES.map((p) => [p, 0])),
  };
}

// Small seedable PRNG (mulberry32) so the page and the tests can replay the same day.
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(xs: readonly T[], r: number): T => xs[Math.min(xs.length - 1, Math.floor(r * xs.length))] as T;

export function step(prev: FlowState, rand: () => number): { state: FlowState; event: FlowEvent } {
  // A demo day is a fixed number of events; then the store starts fresh instead of drifting into
  // an all-denied, empty-vault loop nobody would watch.
  const base = prev.events >= DAY_EVENTS ? initialFlow(prev.day + 1) : prev;
  const s: FlowState = structuredClone(base);
  s.events += 1;

  if (rand() < 0.3 && s.handoffs.length) {
    const h = pick(s.handoffs, rand());
    return { state: s, event: { kind: "handoff", from: h.from, to: h.to, label: h.label } };
  }

  const edges = s.agents.flatMap((a) => a.pays.map((to) => ({ a, to })));
  const { a, to } = pick(edges, rand());
  const amount = cents(2 + rand() * a.limit * 0.22);
  if (a.status === "paused") return { state: s, event: { kind: "blocked", from: a.id, to, amount: 0 } };
  if (a.spent + amount > a.limit || s.spentToday + amount > s.ceiling || amount > s.vault) {
    s.deniedToday += 1;
    return { state: s, event: { kind: "denied", from: a.id, to, amount } };
  }
  a.spent = cents(a.spent + amount);
  a.balance = cents(a.balance - amount);
  s.vault = cents(s.vault - amount);
  s.spentToday = cents(s.spentToday + amount);
  s.payeeToday[to] = cents((s.payeeToday[to] ?? 0) + amount);
  return { state: s, event: { kind: "settled", from: a.id, to, amount } };
}
