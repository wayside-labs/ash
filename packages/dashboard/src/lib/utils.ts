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
 * One renderer for the three states a balance can be in, so no page has to
 * decide on its own what to show when an address was never provisioned.
 */
export function formatMoney(money: Money, hidden = false): string {
  if (hidden && money.kind !== "unknown") return HIDDEN_AMOUNT;
  switch (money.kind) {
    case "chain":
      return formatSol(money.sol);
    case "demo":
      return formatUsd(money.usd);
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
  if (money.kind === "chain") return "text-foreground";
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

const NATIVE_MINT = "So11111111111111111111111111111111111111112";

/** Known mints get their ticker; anything else falls back to a short address. */
export function mintSymbol(mint: string): string {
  if (mint === NATIVE_MINT) return "SOL";
  return truncateAddress(mint, 4);
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
