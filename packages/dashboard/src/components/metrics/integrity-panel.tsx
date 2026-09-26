"use client";

import { CircleDashed, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/i18n/locale-provider";
import { denialsFromHistory } from "@/lib/metrics/history-aggregate";
import type { MetricsSummary, PaymentRecordView } from "@/lib/metrics/schema";
import { truncateAddress } from "@/lib/utils";

/**
 * §6 — the audit chain and program-level refusals replayed from history.
 */
export function IntegrityPanel({
  summary,
  history,
  verifiedThrough = {},
}: {
  summary: MetricsSummary;
  history?: PaymentRecordView[];
  verifiedThrough?: Record<string, string | null>;
}) {
  const { t } = useTranslation();
  const rows = summary.integrity;
  const refusals = useMemo(
    () => (history ? denialsFromHistory(history) : { count: 0, byReason: {} }),
    [history],
  );

  const topReasons = Object.entries(refusals.byReason)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 6);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t("metrics.integrity.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("metrics.integrity.empty")}</p>
        ) : (
          <ul className="space-y-2" data-testid="integrity-rows">
            {rows.map((row) => {
              const verified = verifiedThrough[row.session];
              return (
                <li
                  key={row.session}
                  className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm">
                      {row.label || truncateAddress(row.session, 6)}
                      {row.revoked && (
                        <Badge variant="outline" className="ml-2 text-[10px]">
                          {t("common.revoked")}
                        </Badge>
                      )}
                    </p>
                    <p className="num text-[11px] text-faint-foreground">
                      {t("metrics.integrity.seq", { seq: row.seq })} ·{" "}
                      {t("metrics.integrity.head", { head: truncateAddress(row.auditHead, 8) })}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint-foreground">
                    {verified === undefined || verified === null ? (
                      <>
                        <CircleDashed className="h-3 w-3" aria-hidden />
                        {t("metrics.integrity.notVerified")}
                      </>
                    ) : (
                      t("metrics.integrity.verified", { seq: verified })
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {topReasons.length > 0 && (
          <div className="space-y-2" data-testid="integrity-refusals">
            <p className="text-xs font-medium">{t("metrics.integrity.refusedByReason")}</p>
            <ul className="space-y-1 text-xs text-muted-foreground">
              {topReasons.map(([reason, count]) => (
                <li key={reason} className="flex justify-between gap-2">
                  <span className="num">{reason}</span>
                  <span className="num">{count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">{t("metrics.integrity.explain")}</p>
      </CardContent>
    </Card>
  );
}
