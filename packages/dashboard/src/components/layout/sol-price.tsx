"use client";

import { SolanaMark } from "@/components/wallet/solana-mark";
import { useSolPrice } from "@/hooks/use-dashboard";
import { intlLocale } from "@/i18n";
import { useLocale } from "@/i18n/locale-provider";

/**
 * Live SOL/USD in the top bar. `useSolPrice` refreshes every 15 seconds, and it backs off to a
 * minute while every upstream refuses. Renders nothing until a price arrives, so a failed read
 * shows no stale or made-up number.
 */
export function SolPrice() {
  const locale = intlLocale(useLocale());
  const { data } = useSolPrice();
  if (!data) return null;

  const usd = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(data.usd);

  return (
    <div
      className="hidden items-center gap-1.5 text-sm font-medium sm:flex"
      data-testid="sol-price"
      title={`SOL/USD · ${data.source}`}
    >
      <SolanaMark className="h-3.5 w-[18px]" />
      <span className="num">{usd}</span>
    </div>
  );
}
