"use client";

import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import { priceMoveUsd } from "@/lib/metrics/fold";
import type { MetricsSummary } from "@/lib/metrics/schema";
import { cn, formatChangePct, formatUsd } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";

/** How stale a spot price has to be before the age is worth pointing out. */
const STALE_AFTER_MS = 120_000;

function ageLabel(asOf: string, t: (key: string, params?: Record<string, number>) => string) {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(asOf)) / 1000));
  if (seconds < 60) return t("metrics.value.ageSeconds", { count: seconds });
  return t("metrics.value.ageMinutes", { count: Math.round(seconds / 60) });
}

/**
 * §4 — value, and what moved it.
 *
 * Informational by construction. There is no cost basis anywhere in Agent Rails
 * and no price history, so this cannot be profit and loss and does not pretend
 * to be: it marks current holdings to market and attributes the day's move to
 * the day's price change, which is the one thing a spot feed can honestly say.
 */
export function ValuationCard({ summary }: { summary: MetricsSummary }) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const hidden = useBalancesHidden();

  const price = summary.price;
  const move = priceMoveUsd(summary);
  const stale = price ? Date.now() - Date.parse(price.asOf) > STALE_AFTER_MS : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("metrics.value.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <p className="text-xs uppercase tracking-[0.12em] text-subtle-foreground">
            {t("metrics.value.marked")}
          </p>
          <p className="num text-2xl font-bold">
            {summary.holdings.usd === null ? "—" : formatUsd(summary.holdings.usd, intl, hidden)}
          </p>
        </div>

        {price ? (
          <>
            <p className="num text-xs text-muted-foreground">
              {t("metrics.value.spot", {
                price: formatUsd(price.usd, intl),
                change: price.change24h === null ? "—" : formatChangePct(price.change24h, intl),
                source: price.source,
                age: ageLabel(price.asOf, t),
              })}
            </p>
            {stale && (
              <p className="text-[11px] text-warning">
                {t("metrics.value.priceStale", { age: ageLabel(price.asOf, t) })}
              </p>
            )}
            {move !== null && (
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
                <span className="text-sm text-muted-foreground">
                  {t("metrics.value.priceMove")}
                </span>
                <span
                  className={cn(
                    "num text-sm font-medium",
                    move > 0 ? "text-good" : move < 0 ? "text-critical" : "text-muted-foreground",
                  )}
                >
                  {hidden ? "••••" : `${move > 0 ? "+" : ""}${formatUsd(move, intl)}`}
                </span>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("metrics.value.priceUnavailable")}</p>
        )}

        <p className="flex gap-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
          <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>
            {t("metrics.value.disclaimer")}
            {summary.holdings.excluded > 0 &&
              ` ${t("metrics.value.excluded", { count: summary.holdings.excluded })}`}
          </span>
        </p>
      </CardContent>
    </Card>
  );
}
