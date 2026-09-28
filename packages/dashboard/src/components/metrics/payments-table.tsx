"use client";

import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import type { PaymentHistory, PaymentRecordView } from "@/lib/metrics/schema";
import { formatBaseUnits, HIDDEN_AMOUNT } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";
import { PaymentDetailSheet } from "./payment-detail-sheet";

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

export function PaymentsTable({
  history,
  knownCount,
  demo,
  isLoading,
  isError,
  onLoadMore,
  onExport,
  exporting,
}: {
  history: PaymentHistory | undefined;
  /** Exact on-chain `seq` total from §1 — may exceed visible rows. */
  knownCount: number | null;
  demo: boolean;
  isLoading: boolean;
  isError: boolean;
  onLoadMore?: () => void;
  onExport: (format: "csv" | "json") => Promise<void>;
  exporting: boolean;
}) {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const hidden = useBalancesHidden();
  const [selected, setSelected] = useState<PaymentRecordView | null>(null);

  const payments = history?.records ?? [];
  const shown = payments.length;
  const complete = history?.complete ?? true;

  return (
    <>
      <Card data-testid={demo ? "payments-mock" : "payments-table"}>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2">
              {t("metrics.payments.title")}
              {demo && <DemoBadge />}
            </CardTitle>
            {!demo && payments.length > 0 && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting}
                  onClick={() => onExport("csv")}
                >
                  {exporting ? (
                    <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-3.5 w-3.5" />
                  )}
                  {t("metrics.payments.exportCsv")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={exporting}
                  onClick={() => onExport("json")}
                >
                  {t("metrics.payments.exportJson")}
                </Button>
              </div>
            )}
          </div>
          {demo && (
            <p className="text-xs text-muted-foreground">{t("metrics.payments.mockNotice")}</p>
          )}
        </CardHeader>
        <CardContent>
          {isLoading && payments.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </p>
          ) : isError ? (
            <p className="text-sm text-critical">{t("api.error.historyUnavailable")}</p>
          ) : payments.length === 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">{t("metrics.payments.emptyTitle")}</p>
              <p className="text-sm text-muted-foreground">
                {t("metrics.payments.emptyDescription")}
              </p>
              <code className="block overflow-x-auto rounded bg-muted px-2 py-1 text-[11px] text-foreground">
                {t("metrics.payments.emptyCommand")}
              </code>
            </div>
          ) : (
            <div className="space-y-3">
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
                      <th className="pb-2 pr-3 font-medium">{t("metrics.payments.colOutcome")}</th>
                      <th className="pb-2 font-medium">{t("metrics.payments.colRef")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.map((row) => (
                      <tr
                        key={row.intent}
                        className="cursor-pointer border-t border-border/60 hover:bg-muted/40"
                        onClick={() => setSelected(row)}
                      >
                        <td className="num py-2 pr-3 text-xs text-muted-foreground">
                          {new Date(row.ts).toLocaleString(intl, {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </td>
                        <td className="py-2 pr-3 text-xs">{row.agent_name ?? "—"}</td>
                        <td className="py-2 pr-3 text-xs">
                          {row.destination_label ?? t("metrics.payments.unlistedDestination")}
                        </td>
                        <td className="num py-2 pr-3 text-right text-xs">
                          {hidden
                            ? HIDDEN_AMOUNT
                            : row.amount
                              ? `${formatBaseUnits(row.amount, row.decimals ?? 0, intl)} ${row.symbol ?? ""}`
                              : "—"}
                        </td>
                        <td className="py-2 pr-3">
                          <Badge
                            variant={OUTCOME_VARIANT[row.outcome] ?? "outline"}
                            className="text-[10px]"
                          >
                            {t(OUTCOME_KEY[row.outcome] ?? row.outcome)}
                          </Badge>
                        </td>
                        <td className="num py-2 text-xs text-muted-foreground">
                          {row.signature ? row.signature.slice(0, 6) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {!complete && knownCount !== null && history?.oldestSlot && (
                <p className="text-xs text-warning" data-testid="payments-incomplete">
                  {t("metrics.payments.incomplete", {
                    shown: String(shown),
                    known: String(knownCount),
                    slot: history.oldestSlot,
                  })}
                </p>
              )}

              {!complete && onLoadMore && (
                <Button variant="outline" size="sm" onClick={onLoadMore} disabled={isLoading}>
                  {isLoading ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                  {t("metrics.payments.loadMore")}
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <PaymentDetailSheet
        payment={selected}
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
      />
    </>
  );
}
