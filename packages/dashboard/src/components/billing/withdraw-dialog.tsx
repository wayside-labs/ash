"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useBilling, useRequestWithdrawal, useWithdrawals } from "@/hooks/use-billing";
import { useRegion } from "@/hooks/use-region";
import { intlLocale } from "@/i18n";
import { useLocale, useTranslation } from "@/i18n/locale-provider";
import type { WithdrawalDestinationKind } from "@/lib/billing";
import { formatBalance } from "@/lib/region";
import { useAppStore } from "@/stores/app-store";

/**
 * A withdrawal request. The server holds the amount on the ledger the moment it is sent, so it
 * cannot also be spent in chat, and the operator pays it out by hand in USDC to the Solana
 * address given.
 */
export function WithdrawDialog() {
  const open = useAppStore((s) => s.moneyDialog === "withdraw");
  const setMoneyDialog = useAppStore((s) => s.setMoneyDialog);
  const { t } = useTranslation();
  const locale = intlLocale(useLocale());
  const region = useRegion();
  const { data: billing } = useBilling(open);
  const withdrawals = useWithdrawals(open);
  const request = useRequestWithdrawal();

  // The MVP pays out in USDC to a Solana wallet only.
  const kind: WithdrawalDestinationKind = "solana_usdc";
  const [amount, setAmount] = useState("");
  const [destination, setDestination] = useState("");
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (open) {
      setSent(false);
      setAmount("");
      setDestination("");
      request.reset();
    }
    // Reset on open only; `request.reset` is stable.
  }, [open]);

  const usd = { ...region, currency: "USD" as const, usdRate: 1 };
  const available = billing?.balanceMicros ?? 0;
  const pending = (withdrawals.data?.requests ?? []).filter((r) => r.status === "pending");

  const submit = () =>
    request.mutate(
      { amountUsd: amount.trim(), destinationKind: kind, destination: destination.trim() },
      {
        onSuccess: () => {
          setSent(true);
          void withdrawals.refetch();
        },
      },
    );

  return (
    <Dialog open={open} onOpenChange={(next) => setMoneyDialog(next ? "withdraw" : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("withdraw.title")}</DialogTitle>
          <DialogDescription>{t("withdraw.description")}</DialogDescription>
        </DialogHeader>

        {sent ? (
          <div
            className="flex flex-col items-center gap-3 py-4 text-center"
            data-testid="withdraw-sent"
          >
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <p className="font-medium">{t("withdraw.sent")}</p>
            <p className="text-sm text-muted-foreground">{t("withdraw.sentHint")}</p>
            <Button onClick={() => setMoneyDialog(null)}>{t("common.close")}</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("withdraw.available", { amount: formatBalance(available, usd, locale) })}
              {region.currency !== "USD" && ` (${formatBalance(available, region, locale)})`}
            </p>

            <div className="space-y-2">
              <Label htmlFor="withdraw-amount">{t("withdraw.amount")}</Label>
              <div className="flex gap-2">
                <Input
                  id="withdraw-amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(",", "."))}
                  className="num"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAmount((available / 1_000_000).toFixed(2))}
                  disabled={available <= 0}
                >
                  {t("withdraw.max")}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="withdraw-destination">{t("withdraw.kind.solana_usdc")}</Label>
              <Input
                id="withdraw-destination"
                aria-label={t(`withdraw.kind.${kind}.placeholder`)}
                placeholder={t(`withdraw.kind.${kind}.placeholder`)}
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                className={kind === "solana_usdc" ? "font-mono text-xs" : undefined}
              />
            </div>

            {request.error && <p className="text-sm text-destructive">{request.error.message}</p>}

            <Button
              className="w-full"
              onClick={submit}
              disabled={request.isPending || !amount.trim() || !destination.trim()}
            >
              {request.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {t("withdraw.submit")}
            </Button>

            {pending.length > 0 && (
              <div className="space-y-1.5 border-t border-border pt-3">
                <p className="text-xs font-medium text-muted-foreground">{t("withdraw.pending")}</p>
                {pending.map((r) => (
                  <div key={r.id} className="flex items-center justify-between text-xs">
                    <span className="num">{formatBalance(r.amountMicros, usd, locale)}</span>
                    <span className="truncate px-2 text-muted-foreground">
                      {t(`withdraw.kind.${r.destinationKind}`)}
                    </span>
                    <Badge variant="outline">{t(`withdraw.status.${r.status}`)}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
