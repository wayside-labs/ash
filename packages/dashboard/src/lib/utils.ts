// Leaf imports, not the package barrel: the barrel reaches `intent-id`, which
// imports `node:crypto` and cannot be bundled for the browser.
import { NATIVE_MINT } from "@agent-rails/contract/constants";
import { knownMintSymbol } from "@agent-rails/contract/mints";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { Money } from "./types";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function truncateAddress(address: string | null | undefined, chars = 4): string {
  if (!address) return "—";
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}

export const HIDDEN_AMOUNT = "••••";

/** Signed percent for price tickers, e.g. (+2.34%) / (−1.20%). */
export function formatChangePct(value: number, locale = "en-US"): string {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const abs = Math.abs(value);
  const digits = abs >= 10 ? 1 : 2;
  const formatted = abs.toLocaleString(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `(${sign}${formatted}%)`;
}

export function formatUsd(amount: number, locale = "en-US", hidden = false): string {
  if (hidden) return HIDDEN_AMOUNT;
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatSol(sol: number, hidden = false): string {
  if (hidden) return `${HIDDEN_AMOUNT} SOL`;
  const digits = sol === 0 || sol >= 1 ? 4 : 6;
  return `${sol.toFixed(digits).replace(/\.?0+$/, "")} SOL`;
}

/**
 * Renders a token amount with its ticker.
 *
 * Two decimals is the reading most amounts want, but a balance small enough to
 * round to zero there is shown at the mint's full precision instead: "0.00
 * USDC" next to a live vault reads as empty when it is not.
 */
export function formatToken(
  amount: number,
  symbol: string,
  decimals: number,
  hidden = false,
  locale = "en-US",
): string {
  if (hidden) return `${HIDDEN_AMOUNT} ${symbol}`;
  const minor = Math.min(2, decimals);
  const digits = amount !== 0 && Math.abs(amount) < 10 ** -minor ? decimals : minor;
  const formatted = amount.toLocaleString(locale, {
    minimumFractionDigits: Math.min(minor, digits),
    maximumFractionDigits: digits,
  });
  return `${formatted} ${symbol}`;
}

/**
 * One renderer for the states a balance can be in, so no page has to decide on
 * its own what to show when an address was never provisioned.
 */
export function formatMoney(money: Money, hidden = false, locale = "en-US"): string {
  if (hidden && money.kind !== "unknown") return HIDDEN_AMOUNT;
  switch (money.kind) {
    case "chain":
      return formatSol(money.sol);
    case "token":
      return formatToken(money.amount, money.symbol, money.decimals, false, locale);
    case "demo":
      return formatUsd(money.usd, locale);
    default:
      return "—";
  }
}

/**
 * Provenance rides ink level, not hue. Colour is reserved for status, so a
 * demo figure can never be mistaken for a healthy limit — and a real balance
 * is simply the brightest thing in its row.
 */
export function moneyTone(money: Money): string {
  if (money.kind === "chain" || money.kind === "token") return "text-foreground";
  if (money.kind === "demo") return "text-subtle-foreground";
  return "text-faint-foreground";
}

const U64_MAX = "18446744073709551615";

/**
 * Renders a base-unit amount using the mint's decimals. `u64::MAX` is the
 * program's "unlimited" sentinel, not a number worth printing.
 */
export function formatBaseUnits(
  raw: string,
  decimals: number | undefined,
  locale = "en-US",
  unlimitedLabel = "unlimited",
): string {
  if (raw === U64_MAX) return unlimitedLabel;
  if (decimals === undefined) return raw;
  const value = Number(raw) / 10 ** decimals;
  if (!Number.isFinite(value)) return raw;
  return value.toLocaleString(locale, { maximumFractionDigits: decimals });
}

export { NATIVE_MINT };

/**
 * Known mints get their ticker; anything else falls back to a short address.
 * The registry lives in `@agent-rails/contract` so the CLI, the server routes
 * and this renderer all name the same address the same way.
 */
export function mintSymbol(mint: string): string {
  return knownMintSymbol(mint) ?? truncateAddress(mint, 4);
}

export function formatWindow(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}min`;
  return `${seconds}s`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
