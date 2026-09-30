"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBilling } from "@/hooks/use-billing";
import { intlLocale } from "@/i18n";
import { useLocale, useTranslation } from "@/i18n/locale-provider";
import { BPS_DENOMINATOR, formatMicros } from "@/lib/billing";
import { AddBalanceButton } from "./add-balance-button";
import { LedgerList } from "./ledger-list";

/** Balance and ledger for the hosted assistant. Adding credit is the balance page's job; this only links there. */
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
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{t("billing.title")}</CardTitle>
        {data?.enabled && <AddBalanceButton variant="outline" />}
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
                <LedgerList entries={data.entries} locale={locale} />
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
