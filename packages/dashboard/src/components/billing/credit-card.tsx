"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBilling } from "@/hooks/use-billing";
import { intlLocale } from "@/i18n";
import { useLocale, useTranslation } from "@/i18n/locale-provider";
import { BPS_DENOMINATOR, formatMicros, type LedgerEntry } from "@/lib/billing";

function EntryRow({ entry, locale }: { entry: LedgerEntry; locale: string }) {
  const { t } = useTranslation();
  const money = (micros: number) => formatMicros(micros, locale);
  const debit = entry.amountMicros < 0;

  return (
    <li className="flex items-start justify-between gap-3 py-2 text-sm">
      <div className="min-w-0 space-y-0.5">
        <p>
          {t(`billing.kind.${entry.kind}`)}
          {entry.model && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              {entry.model.replace(/^openrouter:/, "")}
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {new Date(entry.createdAt).toLocaleString(locale)}
          {entry.promptTokens !== undefined && entry.completionTokens !== undefined && (
            <>
              {" · "}
              {t("billing.tokens", {
                prompt: entry.promptTokens.toLocaleString(locale),
                completion: entry.completionTokens.toLocaleString(locale),
              })}
            </>
          )}
          {entry.rawCostMicros !== undefined && entry.markupMicros !== undefined && (
            <>
              {" · "}
              {t("billing.breakdown", {
                raw: money(entry.rawCostMicros),
                fee: money(entry.markupMicros),
              })}
            </>
          )}
          {entry.estimated && (
            <span title={t("billing.estimatedHint")}>
              {" · "}
              {t("billing.estimated")}
            </span>
          )}
        </p>
      </div>
      <span className={`num shrink-0 ${debit ? "text-muted-foreground" : "text-emerald-500"}`}>
        {debit ? "" : "+"}
        {money(entry.amountMicros)}
      </span>
    </li>
  );
}

/** Balance and ledger for the hosted assistant. Renders nothing a user can use to add credit — deposits are a separate rail. */
export function CreditCard() {
  const { t } = useTranslation();
  const locale = intlLocale(useLocale());
  const { data, isLoading, error } = useBilling();

  if (data && !data.enabled) return null;

  const markup = data
    ? new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 2 }).format(
        data.markupBps / BPS_DENOMINATOR,
      )
    : "";

  return (
    <Card className="md:col-span-2" data-testid="credit-card">
      <CardHeader>
        <CardTitle>{t("billing.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : error || !data ? (
          <p className="text-sm text-muted-foreground">
            {error instanceof Error ? error.message : t("billing.unavailable")}
          </p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">{t("billing.description", { markup })}</p>
            <div>
              <p className="text-xs text-muted-foreground">{t("billing.balance")}</p>
              <p className="num text-2xl" data-testid="credit-balance">
                {formatMicros(data.balanceMicros, locale)}
              </p>
              {data.balanceMicros < 0 && (
                <p className="text-xs text-muted-foreground">{t("billing.negativeHint")}</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs text-muted-foreground">{t("billing.history")}</p>
              {data.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("billing.empty")}</p>
              ) : (
                <ul className="divide-y divide-border">
                  {data.entries.map((entry) => (
                    <EntryRow key={entry.id} entry={entry} locale={locale} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
