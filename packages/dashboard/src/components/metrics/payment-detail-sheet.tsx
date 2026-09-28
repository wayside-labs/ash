"use client";

import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useTranslation } from "@/i18n/locale-provider";
import type { PaymentRecordView } from "@/lib/metrics/schema";
import { formatBaseUnits, truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

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

function explorerUrl(cluster: string, signature: string): string {
  const base =
    cluster === "mainnet-beta"
      ? "https://explorer.solana.com"
      : `https://explorer.solana.com?cluster=${cluster}`;
  return `${base}/tx/${signature}`;
}

export function PaymentDetailSheet({
  payment,
  open,
  onOpenChange,
}: {
  payment: PaymentRecordView | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const { cluster } = useAppStore();

  if (!payment) return null;

  const showExplorer = Boolean(payment.signature) && !payment.demo;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>
            {t("metrics.payment.title", {
              ref: payment.signature
                ? truncateAddress(payment.signature, 6)
                : payment.intent.slice(-4),
            })}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4 text-sm">
          <div className="flex items-center gap-2">
            <Badge variant={OUTCOME_VARIANT[payment.outcome] ?? "outline"}>
              {t(OUTCOME_KEY[payment.outcome] ?? payment.outcome)}
            </Badge>
            {payment.agent_name && (
              <span className="text-muted-foreground">{payment.agent_name}</span>
            )}
          </div>

          <dl className="space-y-2">
            <div>
              <dt className="text-[11px] uppercase tracking-[0.1em] text-subtle-foreground">
                {t("metrics.payment.intentId")}
              </dt>
              <dd className="num break-all text-xs">{payment.intent}</dd>
            </div>
            {payment.receipt && (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-subtle-foreground">
                  {t("metrics.payment.receipt")}
                </dt>
                <dd className="num break-all text-xs">{payment.receipt}</dd>
              </div>
            )}
            {payment.destination && (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-subtle-foreground">
                  {t("metrics.payments.colTo")}
                </dt>
                <dd className="text-xs">
                  {payment.destination_label ?? t("metrics.payments.unlistedDestination")}
                  <span className="num block text-[11px] text-faint-foreground">
                    {truncateAddress(payment.destination, 8)}
                  </span>
                </dd>
              </div>
            )}
            {payment.mint && payment.amount && (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-subtle-foreground">
                  {t("metrics.payments.colAmount")}
                </dt>
                <dd className="num text-xs">
                  {formatBaseUnits(payment.amount, payment.decimals ?? 0)} {payment.symbol ?? ""}
                </dd>
              </div>
            )}
            {payment.reason_code && (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-subtle-foreground">
                  {t("metrics.payment.reason")}
                </dt>
                <dd className="num text-xs">{payment.reason_code}</dd>
              </div>
            )}
            {payment.source && (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-subtle-foreground">
                  {t("metrics.payment.source")}
                </dt>
                <dd className="text-xs">{payment.source}</dd>
              </div>
            )}
            {payment.units_consumed && (
              <div>
                <dt className="text-[11px] uppercase tracking-[0.1em] text-subtle-foreground">
                  {t("metrics.payment.units")}
                </dt>
                <dd className="num text-xs">{payment.units_consumed}</dd>
              </div>
            )}
          </dl>

          {payment.outcome === "indeterminate" && (
            <p className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-xs text-warning">
              {t("metrics.payment.indeterminateWarning")}
            </p>
          )}

          {showExplorer && payment.signature && (
            <Button variant="outline" size="sm" asChild>
              <a href={explorerUrl(cluster, payment.signature)} target="_blank" rel="noreferrer">
                {t("metrics.payment.openExplorer")}
                <ExternalLink className="ml-2 h-3.5 w-3.5" />
              </a>
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
