"use client";

import { DemoBadge } from "@/components/shared/demo-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import type { PaymentRecordView } from "@/lib/metrics/schema";
import { formatBaseUnits, HIDDEN_AMOUNT } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";

/**
 * §5 — the ledger, which in Phase A is a fixture.
 *
 * Real history needs the event replay: receipts are closeable an hour after their
 * intent expires, so the receipt set is never the ledger, and the log stream ages
 * out of an RPC. Until that lands this table shows `MOCK_PAYMENTS` behind one
 * section-level `DemoBadge`.
 *
 * Section level rather than per row is deliberate. A table where every row carries
 * its own small badge still photographs as real history, and the badge that matters
 * is the one that qualifies the whole panel. No export button either: exporting a
 * fixture as CSV is how a fixture ends up in a board deck.
 */
const OUTCOME_VARIANT: Record<string, "success" | "destructive" | "warning" | "outline"> = {
  settled: "success",
  denied: "destructive",
  indeterminate: "warning",
  review_required: "outline",
};

const OUTCOME_KEY: Record<string, string> = {
  settled: "metrics.payments.outcome.settled",
  denied: "metrics.payments.outcome.denied",
  indeterminate: "metrics.payments.outcome.indeterminate",
  review_required: "metrics.payments.outcome.reviewRequired",
};

export function PaymentsTable({ payments }: { payments: PaymentRecordView[] }) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const hidden = useBalancesHidden();

  return (
    <Card data-testid="payments-mock">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            {t("metrics.payments.title")}
            <DemoBadge />
          </CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">{t("metrics.payments.mockNotice")}</p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-[0.1em] text-subtle-foreground">
                <th className="pb-2 pr-3 font-medium">{t("metrics.payments.colWhen")}</th>
                <th className="pb-2 pr-3 font-medium">{t("metrics.payments.colAgent")}</th>
                <th className="pb-2 pr-3 font-medium">{t("metrics.payments.colTo")}</th>
                <th className="pb-2 pr-3 text-right font-medium">
                  {t("metrics.payments.colAmount")}
                </th>
                <th className="pb-2 font-medium">{t("metrics.payments.colOutcome")}</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((row) => (
                <tr key={row.intent} className="border-t border-border/60">
                  <td className="num py-2 pr-3 text-xs text-muted-foreground">
                    {new Date(row.ts).toLocaleTimeString(intl, {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-2 pr-3 text-xs">{row.agent_name ?? "—"}</td>
                  <td className="py-2 pr-3 text-xs">
                    {row.destination_label ?? t("metrics.payments.unlistedDestination")}
                  </td>
                  <td className="num py-2 pr-3 text-right text-xs">
                    {hidden
                      ? HIDDEN_AMOUNT
                      : `${formatBaseUnits(row.amount ?? "0", row.decimals ?? 0, intl)} ${row.symbol ?? ""}`}
                  </td>
                  <td className="py-2">
                    <Badge
                      variant={OUTCOME_VARIANT[row.outcome] ?? "outline"}
                      className="text-[10px]"
                    >
                      {t(OUTCOME_KEY[row.outcome] ?? row.outcome)}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
