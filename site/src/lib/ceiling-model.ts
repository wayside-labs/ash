// Mirrors the order the on-chain program checks in, so the animation never tells a story the
// program would not: paused, destination, duplicate, per-payment ceiling, window budget.
export type Verdict =
  | "settled"
  | "TREASURY_PAUSED"
  | "DESTINATION_NOT_ALLOWED"
  | "DUPLICATE_INTENT"
  | "EXCEEDS_PER_TX_MAX"
  | "EXCEEDS_WINDOW";

export interface Policy { perTxMax: number; windowBudget: number; allowed: readonly string[]; paused: boolean }
export interface Payment { id: string; to: string; amount: number }
export interface State { spentInWindow: number; seen: ReadonlySet<string> }

export const freshState = (): State => ({ spentInWindow: 0, seen: new Set() });

export function evaluate(p: Policy, s: State, pay: Payment): Verdict {
  if (p.paused) return "TREASURY_PAUSED";
  if (!p.allowed.includes(pay.to)) return "DESTINATION_NOT_ALLOWED";
  if (s.seen.has(pay.id)) return "DUPLICATE_INTENT";
  if (pay.amount > p.perTxMax) return "EXCEEDS_PER_TX_MAX";
  if (s.spentInWindow + pay.amount > p.windowBudget) return "EXCEEDS_WINDOW";
  return "settled";
}

export function apply(p: Policy, s: State, pay: Payment): { verdict: Verdict; state: State } {
  const verdict = evaluate(p, s, pay);
  if (verdict !== "settled") return { verdict, state: s };
  return { verdict, state: { spentInWindow: s.spentInWindow + pay.amount, seen: new Set([...s.seen, pay.id]) } };
}
