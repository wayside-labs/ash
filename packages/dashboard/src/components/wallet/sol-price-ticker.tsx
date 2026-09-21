"use client";

import { useEffect, useRef, useState } from "react";
import { useSolPrice } from "@/hooks/use-dashboard";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import { cn, formatChangePct, formatUsd } from "@/lib/utils";
import { SolanaMark } from "./solana-mark";

type Flash = "up" | "down" | null;

/** Live SOL/USD. Stays in the header whether or not a wallet is connected. */
export function SolPriceTicker() {
  const { t, locale } = useTranslation();
  const { data: price, isFetching } = useSolPrice();
  const intl = intlLocale(locale);
  const prevUsd = useRef<number | null>(null);
  const [flash, setFlash] = useState<Flash>(null);

  useEffect(() => {
    if (price === undefined) return;
    const next = price.usd;
    const prev = prevUsd.current;
    if (prev !== null && next !== prev) {
      setFlash(next > prev ? "up" : "down");
    }
    prevUsd.current = next;
  }, [price?.usd, price]);

  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(null), 1_000);
    return () => window.clearTimeout(timer);
  }, [flash]);

  const change24h = price?.change24h ?? null;
  const changeTone =
    change24h === null ? "text-faint-foreground" : change24h >= 0 ? "text-good" : "text-critical";

  return (
    <div className="flex items-center gap-2" title={t("wallet.spotPrice")}>
      <SolanaMark className="h-4 w-[1.15rem]" />
      <div className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span
          className={cn(
            "num text-sm font-medium tabular-nums",
            !flash && (price ? "text-foreground" : "text-faint-foreground"),
            flash === "up" && "price-flash-up",
            flash === "down" && "price-flash-down",
            isFetching && !price && "animate-pulse",
          )}
        >
          {price ? formatUsd(price.usd, intl) : "—"}
        </span>
        {change24h !== null && (
          <span className={cn("num text-xs tabular-nums", changeTone)}>
            {formatChangePct(change24h, intl)}
          </span>
        )}
      </div>
    </div>
  );
}
