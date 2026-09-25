"use client";

import { CircleDashed, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/i18n/locale-provider";
import type { MetricsSummary } from "@/lib/metrics/schema";
import { truncateAddress } from "@/lib/utils";

/**
 * §6 — the audit chain, as far as Phase A can honestly report it.
 *
 * `seq` and `audit_head` are read straight off `AgentSession`, so they are exact.
 * Verification is not done here: it means replaying every `PaymentExecuted`
 * through `next_audit_head` and comparing the terminus, which needs event history.
 * So each row says "not verified" rather than showing a tick — a recorded head an
 * operator has not checked is not a verified chain, and a green mark that means
 * "we read a field" would be the most misleading thing on the page.
 */
export function IntegrityPanel({ summary }: { summary: MetricsSummary }) {
  const { t } = useTranslation();
  const rows = summary.integrity;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t("metrics.integrity.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("metrics.integrity.empty")}</p>
        ) : (
          <ul className="space-y-2" data-testid="integrity-rows">
            {rows.map((row) => (
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
                  {row.verifiedThroughSeq === null ? (
                    <>
                      <CircleDashed className="h-3 w-3" aria-hidden />
                      {t("metrics.integrity.notVerified")}
                    </>
                  ) : (
                    t("metrics.integrity.verified", { seq: row.verifiedThroughSeq })
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-muted-foreground">{t("metrics.integrity.explain")}</p>
      </CardContent>
    </Card>
  );
}
