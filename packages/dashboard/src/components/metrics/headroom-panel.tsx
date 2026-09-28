"use client";

import { Gauge } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CeilingLegend, CeilingMeter } from "@/components/viz/ceiling-meter";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import { remainingRaw, tightestConstraint } from "@/lib/metrics/fold";
import type { Headroom, MetricsSummary } from "@/lib/metrics/schema";
import { formatBaseUnits, formatWindow, HIDDEN_AMOUNT } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";

/**
 * §2 — are we on budget.
 *
 * Reuses `CeilingMeter` rather than growing a second limits visual: it already
 * carries the owner-ceiling / operator-policy / agent-spend three-band legend, and
 * two different renderings of the same relationship would be two things to keep
 * honest. Everything here is a report; the page links to `/limits` for the full
 * picture and offers no control, because loosening flows downhill and this is the
 * bottom.
 */
export function HeadroomPanel({ summary }: { summary: MetricsSummary }) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const unlimited = t("common.unlimited");
  const hidden = useBalancesHidden();

  const rows = summary.headroom;
  const tightest = tightestConstraint(rows);

  const label = (row: Headroom) => {
    const window =
      row.window === "lifetime"
        ? t("metrics.headroom.lifetime")
        : row.windowSeconds
          ? formatWindow(row.windowSeconds)
          : row.window;
    return `${row.policyName || t("common.unnamed")} · ${row.symbol} · ${window}`;
  };

  return (
    <Card data-testid="headroom-panel">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
            {t("metrics.headroom.title")}
          </CardTitle>
          <CeilingLegend hasCeiling={rows.some((row) => row.ceilingRaw !== null)} />
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {rows.length === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              {t("metrics.headroom.emptyDescription")}
            </p>
            <code className="block rounded bg-muted px-2 py-1 text-[11px] text-foreground">
              {t("metrics.headroom.emptyCommand")}
            </code>
          </div>
        ) : (
          <>
            {rows.map((row) => {
              const decimals = row.decimals;
              // Every amount in the meter — the spent/policy pair and the owner
              // ceiling — goes through `format`, so hiding it here covers all
              // three. The bar widths stay: a proportion is not an amount, and a
              // meter with no bar would hide whether a limit is nearly spent,
              // which is the one thing this panel exists to say.
              const fmt = (value: number) =>
                !Number.isFinite(value)
                  ? unlimited
                  : hidden
                    ? `${HIDDEN_AMOUNT} ${row.symbol}`
                    : `${value.toLocaleString(intl, { maximumFractionDigits: decimals })} ${row.symbol}`;
              const toNumber = (raw: string) => Number(raw) / 10 ** decimals;

              return (
                // Wrapped rather than tagging `CeilingMeter` itself: /limits shares
                // that component, and a handle this panel needs is not its business.
                <div key={`${row.policy}-${row.mint}-${row.window}`} data-testid="headroom-meter">
                  <CeilingMeter
                    label={label(row)}
                    ceiling={row.ceilingRaw === null ? null : toNumber(row.ceilingRaw)}
                    policy={row.unlimited ? Number.POSITIVE_INFINITY : toNumber(row.policyMaxRaw)}
                    spent={toNumber(row.spentRaw)}
                    format={fmt}
                  />
                </div>
              );
            })}

            {tightest && (
              <p className="border-t border-border pt-3 text-xs text-muted-foreground">
                {t("metrics.headroom.tightest", {
                  amount: hidden
                    ? `${HIDDEN_AMOUNT} ${tightest.symbol}`
                    : `${formatBaseUnits(remainingRaw(tightest), tightest.decimals, intl)} ${tightest.symbol}`,
                  label: label(tightest),
                })}
              </p>
            )}
          </>
        )}

        <Link
          href="/limits"
          className="inline-block text-xs text-primary transition-opacity hover:opacity-80"
        >
          {t("metrics.headroom.openLimits")} →
        </Link>
      </CardContent>
    </Card>
  );
}
