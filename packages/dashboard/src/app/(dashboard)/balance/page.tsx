"use client";

import { ArrowDownToLine, ArrowUpFromLine, Info } from "lucide-react";
import { LedgerList } from "@/components/billing/ledger-list";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBilling } from "@/hooks/use-billing";
import { useRegion } from "@/hooks/use-region";
import { intlLocale } from "@/i18n";
import { useLocale, useTranslation } from "@/i18n/locale-provider";
import { BPS_DENOMINATOR } from "@/lib/billing";
import { formatBalance } from "@/lib/region";
import { balanceState } from "@/lib/shell";
import { cn } from "@/lib/utils";
import { useAppStore, useBalancesHidden } from "@/stores/app-store";

/**
 * Saldo: the balance, the same Deposit and Withdraw the top bar opens, and the full extrato.
 * Deposits are Solana Pay USDC, credited when the server finds the finalized transfer; a
 * withdrawal holds the amount and the operator pays it out (docs/runbooks/chat-credit-billing.md).
 */
export default function BalancePage() {
  const { t } = useTranslation();
  const locale = intlLocale(useLocale());
  const hidden = useBalancesHidden();
  const { data, isLoading, error } = useBilling();
  const region = useRegion();
  const setMoneyDialog = useAppStore((s) => s.setMoneyDialog);

  return (
    <div>
      <PageHeader title={t("balance.title")} description={t("balance.description")} />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : error || !data ? (
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : t("billing.unavailable")}
        </p>
      ) : !data.enabled ? (
        <Card className="max-w-2xl">
          <CardContent className="flex items-start gap-2 p-4">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">{t("billing.disabled")}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-1 p-5">
                <p className="text-xs text-muted-foreground">{t("balance.label")}</p>
                <p
                  className={cn(
                    "num text-3xl font-semibold",
                    balanceState(data) === "funded" ? "text-foreground" : "text-destructive",
                  )}
                  data-testid="balance-page-amount"
                >
                  {hidden ? "••••" : formatBalance(data.balanceMicros, region, locale)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t("billing.description", {
                    markup: new Intl.NumberFormat(locale, {
                      style: "percent",
                      maximumFractionDigits: 2,
                    }).format(data.markupBps / BPS_DENOMINATOR),
                  })}
                </p>
                {data.balanceMicros < 0 && (
                  <p className="text-xs text-destructive">{t("billing.negativeHint")}</p>
                )}
              </CardContent>
            </Card>

            <Card id="add" className="scroll-mt-4" data-testid="add-balance">
              <CardHeader>
                <CardTitle>{t("balance.add")}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Button onClick={() => setMoneyDialog("deposit")}>
                  <ArrowDownToLine className="h-4 w-4" />
                  {t("header.deposit")}
                </Button>
                <Button variant="outline" onClick={() => setMoneyDialog("withdraw")}>
                  <ArrowUpFromLine className="h-4 w-4" />
                  {t("header.withdraw")}
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("balance.statement")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.entries.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("billing.empty")}</p>
              ) : (
                <LedgerList entries={data.entries} locale={locale} />
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
