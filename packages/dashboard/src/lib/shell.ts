/**
 * The consumer shell (sign in → add balance → ask) and the operator shell share one app. What
 * decides which one a page belongs to lives here, pure, so the sidebar, the header and the home
 * route cannot disagree about it.
 *
 * This is presentation, not privilege. Every advanced route stays reachable by URL and keeps its
 * own server-side checks; the simple shell only stops showing a newcomer a cluster picker and a
 * vault before they have asked a single question.
 */

import type { BillingSummary } from "@/lib/billing";

/**
 * `simple` puts chat + balance at `/`. `operator` restores the chat + workflows split there, for
 * a self-hosted operator who never wanted the consumer framing. `/advanced` serves that split
 * under either mode, so switching the flag never strands a route.
 */
export type ShellMode = "simple" | "operator";

export function parseShellMode(raw: string | undefined): ShellMode {
  return raw?.trim().toLowerCase() === "operator" ? "operator" : "simple";
}

export const ADVANCED_HOME_PATH = "/advanced";
export const BALANCE_PATH = "/balance";

/** Routes that render the pared-down header: no cluster, no mode switch, no SOL ticker. */
export function isSimpleRoute(pathname: string, mode: ShellMode): boolean {
  if (pathname === "/") return mode === "simple";
  return pathname === BALANCE_PATH || pathname.startsWith(`${BALANCE_PATH}/`);
}

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

/**
 * Inlined at build time, like every `NEXT_PUBLIC_` var: reading it per request would force every
 * dashboard route dynamic just to pick a nav layout. Changing it means rebuilding.
 */
export const SHELL_MODE: ShellMode = parseShellMode(process.env.NEXT_PUBLIC_DASHBOARD_SHELL);
