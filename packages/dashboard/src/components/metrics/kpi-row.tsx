"use client";

import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import type { MetricsSummary } from "@/lib/metrics/schema";
import { formatBaseUnits, formatUsd, HIDDEN_AMOUNT } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";
import { KpiTile } from "./kpi-tile";

/** §1 — the four numbers, each with its provenance attached. */
export function KpiRow({ summary }: { summary: MetricsSummary }) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const hidden = useBalancesHidden();

  const amount = (raw: string, decimals: number, symbol: string) =>
    hidden ? `${HIDDEN_AMOUNT} ${symbol}` : `${formatBaseUnits(raw, decimals, intl)} ${symbol}`;

  const holdings = summary.holdings;
  const spend = summary.spend;
  const [firstAsset, ...restAssets] = holdings.assets;
  const [firstSpend, ...restSpend] = spend.byMint;

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <KpiTile
        testId="kpi-holdings"
        label={t("metrics.headline.holdings")}
        value={
          holdings.usd === null
            ? firstAsset
              ? amount(firstAsset.raw, firstAsset.decimals, firstAsset.symbol)
              : "—"
            : formatUsd(holdings.usd, intl, hidden)
        }
        exactness={holdings.assets.length === 0 ? "unavailable" : "counter"}
        secondary={
          holdings.usd === null ? null : (
            <div className="space-y-0.5">
              {holdings.assets.map((asset) => (
                <p key={asset.mint} className="text-xs">
                  {amount(asset.raw, asset.decimals, asset.symbol)}
                </p>
              ))}
            </div>
          )
        }
      >
        {holdings.partial && (
          <p className="pt-1 text-[11px] text-warning">
            {t(
              holdings.excluded === 1
                ? "metrics.headline.holdingsPartial"
                : "metrics.headline.holdingsPartialPlural",
              { count: holdings.excluded },
            )}
          </p>
        )}
        {holdings.usd === null && firstAsset && restAssets.length > 0 && (
          <div className="space-y-0.5 pt-1">
            {restAssets.map((asset) => (
              <p key={asset.mint} className="num text-xs text-muted-foreground">
                {amount(asset.raw, asset.decimals, asset.symbol)}
              </p>
            ))}
          </div>
        )}
      </KpiTile>

      <KpiTile
        testId="kpi-spend"
        label={t("metrics.headline.spent")}
        value={firstSpend ? amount(firstSpend.raw, firstSpend.decimals, firstSpend.symbol) : "—"}
        tone={spend.exactness === "unavailable" ? "text-faint-foreground" : undefined}
        exactness={spend.exactness}
        secondary={
          spend.usd === null ? null : (
            <p className="text-xs">{formatUsd(spend.usd, intl, hidden)}</p>
          )
        }
      >
        {restSpend.length > 0 && (
          <div className="space-y-0.5 pt-1">
            {restSpend.map((asset) => (
              <p key={asset.mint} className="num text-xs text-muted-foreground">
                {amount(asset.raw, asset.decimals, asset.symbol)}
              </p>
            ))}
          </div>
        )}
      </KpiTile>

      <KpiTile
        testId="kpi-payments"
        label={t("metrics.headline.payments")}
        value={summary.payments.exactness === "unavailable" ? "—" : String(summary.payments.count)}
        tone={summary.payments.exactness === "unavailable" ? "text-faint-foreground" : undefined}
        exactness={summary.payments.exactness}
        {...(summary.payments.exactness === "counter" && summary.payments.lifetimeOnly
          ? { exactnessExtra: t("metrics.headline.paymentsLifetime") }
          : {})}
      />

      {/*
        Refused is the one tile that is structurally empty in Phase A: pre-chain
        denials never reach the chain, so the browser cannot see them at all. An
        em dash plus the reason is the honest rendering; a zero would claim the
        agents never tried anything odd.
      */}
      <KpiTile
        testId="kpi-denials"
        label={t("metrics.headline.refused")}
        value={summary.denials.count === null ? "—" : String(summary.denials.count)}
        tone="text-faint-foreground"
        exactness={summary.denials.exactness}
      >
        <p className="pt-1 text-[11px] text-muted-foreground">
          {t("metrics.headline.refusedEmpty")}
        </p>
      </KpiTile>
    </div>
  );
}
