"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import type { MetricsSummary } from "@/lib/metrics/schema";
import { formatBaseUnits, HIDDEN_AMOUNT } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";
import { ExactnessNote } from "./exactness-note";

/**
 * §3 left — what was spent, split by token.
 *
 * A stacked bar in plain CSS. The dashboard ships no charting library and four
 * segments do not justify one; the share is computed in base units so a large
 * u64 cannot lose precision on the way to a percentage.
 */
const SEGMENT_INK = [
  "bg-primary",
  "bg-ceiling",
  "bg-warning",
  "bg-serious",
  "bg-border-strong",
] as const;

export function TokenSplit({ summary }: { summary: MetricsSummary }) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const hidden = useBalancesHidden();

  const rows = summary.spend.byMint;
  // Shares come from a bigint ratio scaled to basis points: dividing two u64s as
  // floats is fine for a bar width, but only after the division, not before.
  const total = rows.reduce((sum, row) => sum + BigInt(row.raw), 0n);
  const shares = rows.map((row) => ({
    row,
    pct: total === 0n ? 0 : Number((BigInt(row.raw) * 10_000n) / total) / 100,
  }));

  return (
    <Card data-testid="token-split">
      <CardHeader>
        <CardTitle>{t("metrics.byToken.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 || total === 0n ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("metrics.byToken.emptyTitle")}</p>
            <p className="text-sm text-muted-foreground">{t("metrics.byToken.emptyDescription")}</p>
          </div>
        ) : (
          <>
            <div
              className="surface-sunken flex h-2.5 w-full overflow-hidden rounded-full"
              role="img"
              aria-label={t("metrics.byToken.title")}
            >
              {shares.map(({ row, pct }, index) => (
                <div
                  key={row.mint}
                  className={SEGMENT_INK[index % SEGMENT_INK.length]}
                  style={{ width: `${pct}%` }}
                />
              ))}
            </div>

            <div className="space-y-1.5">
              {shares.map(({ row, pct }, index) => (
                <div key={row.mint} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="flex items-center gap-2">
                    <span
                      className={`h-2 w-4 shrink-0 rounded-full ${SEGMENT_INK[index % SEGMENT_INK.length]}`}
                      aria-hidden
                    />
                    {row.symbol}
                  </span>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {hidden ? HIDDEN_AMOUNT : formatBaseUnits(row.raw, row.decimals, intl)}{" "}
                    <span className="text-faint-foreground">
                      {pct.toLocaleString(intl, { maximumFractionDigits: 1 })}%
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
        <ExactnessNote exactness={summary.spend.exactness} />
      </CardContent>
    </Card>
  );
}
