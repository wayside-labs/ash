/**
 * Paths and balance states the header, the sidebar and the billing pages share, pure so they
 * cannot disagree. (Until 2026-10 this also chose between a "simple" and an "operator" shell;
 * the dashboard now has one: chat + workflows at `/`, the client's money in the top bar.)
 */

import type { BillingSummary } from "@/lib/billing";

export const BALANCE_PATH = "/balance";
export const ACCOUNT_PATH = "/account";

/** How many ledger rows the home page's extrato shows; the balance page shows all the API returns. */
export const LEDGER_PREVIEW = 5;

/**
 * - `off`: billing is disabled on this server (local JSON mode); there is no balance to show.
 * - `empty`: nothing to spend — the state the "add balance to start" prompt is for.
 * - `negative`: a reply cost more than was left; the next turn will be refused.
 * - `funded`: the chat can run.
 */
export type BalanceState = "off" | "empty" | "negative" | "funded";

export function balanceState(
  summary: Pick<BillingSummary, "enabled" | "balanceMicros">,
): BalanceState {
  if (!summary.enabled) return "off";
  if (summary.balanceMicros < 0) return "negative";
  if (summary.balanceMicros === 0) return "empty";
  return "funded";
}
