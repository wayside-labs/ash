"use client";

import { Info, QrCode, Zap } from "lucide-react";
import { LedgerList } from "@/components/billing/ledger-list";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBilling } from "@/hooks/use-billing";
import { intlLocale } from "@/i18n";
import { useLocale, useTranslation } from "@/i18n/locale-provider";
import { BPS_DENOMINATOR, formatMicros } from "@/lib/billing";
import { balanceState } from "@/lib/shell";
import { cn } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";

/**
 * Saldo: the balance, the one door for adding to it, and the full extrato.
 *
 * The deposit rails (PIX, Solana Pay) are not built. They are listed, disabled, so the CTA every
 * other page points here has somewhere to land and the reader learns what is coming; the credit
 * that exists today is the starter grant and an operator's manual top-up
 * (docs/runbooks/chat-credit-billing.md). A rail lands as a verified callback appending a
 * `deposit` row — never as a route a signed-in user can call to mint credit.
 */
export default function BalancePage() {
  const { t } = useTranslation();
  const locale = intlLocale(useLocale());
  const hidden = useBalancesHidden();
  const { data, isLoading, error } = useBilling();

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
                  {hidden ? "••••" : formatMicros(data.balanceMicros, locale)}
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
              <CardContent className="space-y-3">
                <DepositRail icon={QrCode} label={t("balance.rail.pix")} />
                <DepositRail icon={Zap} label={t("balance.rail.solanaPay")} />
                <p className="text-xs text-muted-foreground">{t("balance.railsPending")}</p>
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

function DepositRail({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5 opacity-70"
      aria-disabled
    >
      <span className="flex items-center gap-2 text-sm">
        <Icon className="h-4 w-4 text-muted-foreground" />
        {label}
      </span>
      <Badge variant="outline">{t("balance.soon")}</Badge>
    </div>
  );
}
