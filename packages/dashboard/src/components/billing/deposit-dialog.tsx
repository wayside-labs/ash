"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Copy, ExternalLink, Loader2, QrCode as QrIcon, Zap } from "lucide-react";
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
import { useToast } from "@/components/ui/toast";
import { BILLING_QUERY_KEY, checkDeposit, createDeposit, useRails } from "@/hooks/use-billing";
import { useRegion } from "@/hooks/use-region";
import { intlLocale } from "@/i18n";
import { useLocale, useTranslation } from "@/i18n/locale-provider";
import type { DepositIntentView } from "@/lib/billing";
import { type DepositRail, depositRailsFor, formatBalance } from "@/lib/region";
import { useAppStore } from "@/stores/app-store";
import { QrCode } from "./qr-code";

const POLL_MS = 5_000;
const PRESETS = ["5", "10", "25", "50"];

/**
 * Deposit, opened from the header (or any "add balance" prompt). The rails offered follow the
 * viewer's region; which ones actually work follows the server's config. Credit lands only when
 * the server finds the finalized transfer — this dialog just shows the request and polls.
 */
export function DepositDialog() {
  const open = useAppStore((s) => s.moneyDialog === "deposit");
  const setMoneyDialog = useAppStore((s) => s.setMoneyDialog);
  const { t } = useTranslation();
  const locale = intlLocale(useLocale());
  const region = useRegion();
  const rails = useRails(open);
  const toast = useToast();
  const queryClient = useQueryClient();

  const [rail, setRail] = useState<DepositRail>("solana_pay_usdc");
  const [amount, setAmount] = useState("10");
  const [intent, setIntent] = useState<DepositIntentView | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const offered = depositRailsFor(region.country);

  // A fresh dialog each time: an old QR must never be paid twice by mistake.
  useEffect(() => {
    if (!open) {
      setIntent(null);
      setError(null);
    } else {
      setRail("solana_pay_usdc");
    }
  }, [open]);

  useEffect(() => {
    if (!open || !intent || intent.status !== "pending") return;
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const { intent: next } = await checkDeposit(intent.id);
        if (cancelled || next.status !== "confirmed") return;
        setIntent(next);
        void queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEY });
      } catch {
        // A failed poll is retried on the next tick; the transfer is on chain either way.
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, intent, queryClient]);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const { intent: created } = await createDeposit(amount.trim());
      setIntent(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setCreating(false);
    }
  };

  const copy = async (text: string) => {
    await navigator.clipboard.writeText(text).catch(() => {});
    toast(t("deposit.linkCopied"));
  };

  const usdPreview = (() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0 || region.currency === "USD") return null;
    return formatBalance(Math.round(n * 1_000_000), region, locale);
  })();

  const solanaPay = rails.data?.solanaPay;

  return (
    <Dialog open={open} onOpenChange={(next) => setMoneyDialog(next ? "deposit" : null)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("deposit.title")}</DialogTitle>
          <DialogDescription>{t("deposit.description")}</DialogDescription>
        </DialogHeader>

        {!intent && (
          <div className="space-y-4">
            <fieldset className="grid gap-2">
              <legend className="sr-only">{t("deposit.method")}</legend>
              {offered.map((id) => {
                const soon = id === "pix";
                const selected = rail === id && !soon;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={selected}
                    disabled={soon}
                    onClick={() => setRail(id)}
                    data-testid={`deposit-rail-${id}`}
                    className={`flex items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      {id === "pix" ? (
                        <QrIcon className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <Zap className="h-4 w-4 text-primary" />
                      )}
                      <span>
                        <span className="block font-medium">{t(`deposit.rail.${id}`)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {t(`deposit.rail.${id}.hint`)}
                        </span>
                      </span>
                    </span>
                    {soon && <Badge variant="outline">{t("balance.soon")}</Badge>}
                  </button>
                );
              })}
            </fieldset>

            {solanaPay && !solanaPay.enabled ? (
              <p className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                {t("deposit.railOff")}
              </p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="deposit-amount">{t("deposit.amount")}</Label>
                <div className="flex gap-2">
                  <Input
                    id="deposit-amount"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(",", "."))}
                    className="num"
                  />
                  <span className="flex items-center text-sm text-muted-foreground">USDC</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((preset) => (
                    <Button
                      key={preset}
                      type="button"
                      size="sm"
                      variant={amount === preset ? "secondary" : "outline"}
                      onClick={() => setAmount(preset)}
                    >
                      ${preset}
                    </Button>
                  ))}
                </div>
                {usdPreview && (
                  <p className="text-xs text-muted-foreground">
                    {t("deposit.approx", { amount: usdPreview })}
                  </p>
                )}
                {solanaPay?.cluster === "devnet" && (
                  <p className="text-xs text-warning">{t("deposit.devnet")}</p>
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button className="w-full" onClick={create} disabled={creating || !solanaPay}>
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t("deposit.create")}
                </Button>
              </div>
            )}
          </div>
        )}

        {intent?.status === "pending" && (
          <div className="flex flex-col items-center gap-3 text-center">
            <QrCode value={intent.url} label={t("deposit.qrLabel")} />
            <p className="text-sm">
              {t("deposit.scan", {
                amount: formatBalance(
                  intent.amountMicros,
                  { ...region, currency: "USD", usdRate: 1 },
                  locale,
                ),
              })}
            </p>
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <Button asChild className="flex-1">
                <a href={intent.url}>
                  <ExternalLink className="h-4 w-4" />
                  {t("deposit.openWallet")}
                </a>
              </Button>
              <Button variant="outline" className="flex-1" onClick={() => copy(intent.url)}>
                <Copy className="h-4 w-4" />
                {t("deposit.copyLink")}
              </Button>
            </div>
            <p
              className="flex items-center gap-2 text-xs text-muted-foreground"
              data-testid="deposit-waiting"
            >
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t("deposit.waiting")}
            </p>
          </div>
        )}

        {intent?.status === "confirmed" && (
          <div
            className="flex flex-col items-center gap-3 py-4 text-center"
            data-testid="deposit-confirmed"
          >
            <CheckCircle2 className="h-10 w-10 text-primary" />
            <p className="font-medium">
              {t("deposit.confirmed", {
                amount: formatBalance(intent.creditedMicros ?? intent.amountMicros, region, locale),
              })}
            </p>
            <Button onClick={() => setMoneyDialog(null)}>{t("common.close")}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
