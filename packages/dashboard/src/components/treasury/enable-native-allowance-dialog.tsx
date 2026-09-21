"use client";

import { AlertTriangle, ExternalLink, Info, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { type EnableNativeAllowanceResult, useEnableNativeAllowance } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { explorerTxUrl } from "@/lib/solana";
import { formatBaseUnits, mintSymbol, truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export type EnableNativeAllowanceTarget = {
  treasury: string;
  mint: string;
  decimals: number;
};

export type EnableNativeAllowanceDialogProps = {
  target: EnableNativeAllowanceTarget | null;
  onClose: () => void;
};

/** Default expiry: 90 days from now, rounded to the next hour for datetime-local. */
function defaultExpiryLocal(): string {
  const date = new Date(Date.now() + 90 * 86_400_000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

function parseAmountToBaseUnits(raw: string, decimals: number): bigint | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(".");
  if (parts.length > 2) return null;
  const whole = parts[0] ?? "";
  const frac = parts[1] ?? "";
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(frac)) return null;
  if (frac.length > decimals) return null;
  const paddedFrac = frac.padEnd(decimals, "0");
  const combined = `${whole || "0"}${paddedFrac}`.replace(/^0+(?=\d)/, "");
  if (!/^\d+$/.test(combined)) return null;
  try {
    return BigInt(combined);
  } catch {
    return null;
  }
}

function localDateTimeToUnixSeconds(value: string): bigint | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return BigInt(Math.floor(ms / 1000));
}

export function EnableNativeAllowanceDialog({ target, onClose }: EnableNativeAllowanceDialogProps) {
  const { t, locale } = useTranslation();
  const { cluster } = useAppStore();
  const enable = useEnableNativeAllowance();
  const toast = useToast();
  const [amountCap, setAmountCap] = useState("");
  const [expiryLocal, setExpiryLocal] = useState(defaultExpiryLocal);
  const [result, setResult] = useState<EnableNativeAllowanceResult | null>(null);

  const open = target !== null;
  const symbol = target ? mintSymbol(target.mint) : "";

  useEffect(() => {
    if (open) {
      setAmountCap("");
      setExpiryLocal(defaultExpiryLocal());
      setResult(null);
      enable.reset();
    }
  }, [open, enable.reset]);

  const amountBase = useMemo(
    () => (target ? parseAmountToBaseUnits(amountCap, target.decimals) : null),
    [amountCap, target],
  );
  const expiryTs = useMemo(() => localDateTimeToUnixSeconds(expiryLocal), [expiryLocal]);
  const expiryInFuture = expiryTs !== null && expiryTs > BigInt(Math.floor(Date.now() / 1000));
  const valid = amountBase !== null && amountBase > 0n && expiryInFuture;
  const pending = enable.isPending;

  async function submit() {
    if (!valid || !target || amountBase === null || expiryTs === null) return;
    try {
      const outcome = await enable.mutateAsync({
        treasury: target.treasury,
        mint: target.mint,
        amountCap: amountBase,
        expiryTs,
      });
      setResult(outcome);
      toast(
        outcome.status === "confirmed"
          ? t("nativeAllowance.toast.enabled", {
              signature: truncateAddress(outcome.signature, 6),
            })
          : t("nativeAllowance.toast.pending", {
              signature: truncateAddress(outcome.signature, 6),
            }),
        outcome.status === "confirmed" ? "success" : "error",
      );
    } catch {
      // Inline error from mutation.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-accent" />
            {t("nativeAllowance.dialog.title")}
          </DialogTitle>
          <DialogDescription>{t("nativeAllowance.dialog.description")}</DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-3">
            <div
              className={`rounded-lg border p-3 text-sm ${
                result.status === "confirmed"
                  ? "border-good/40 bg-good/5"
                  : "border-warning/40 bg-warning/5"
              }`}
            >
              <p className="font-medium">
                {t(
                  result.status === "confirmed"
                    ? "nativeAllowance.confirmedTitle"
                    : "nativeAllowance.timeoutTitle",
                )}
              </p>
              <p className="num mt-1 break-all text-xs text-muted-foreground">{result.signature}</p>
            </div>
            <Button variant="outline" className="w-full" asChild>
              <a href={explorerTxUrl(result.signature, cluster)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                {t("nativeAllowance.viewOnExplorer")}
              </a>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {target && (
              <div className="grid gap-1 rounded-lg border border-border bg-elevated/30 p-3 text-xs">
                <Row label={t("nativeAllowance.dialog.mint")} value={symbol} />
                <Row
                  label={t("nativeAllowance.dialog.treasury")}
                  value={truncateAddress(target.treasury, 6)}
                  mono
                />
              </div>
            )}

            <div className="rounded-lg border border-border bg-elevated/40 px-3 py-2 text-sm text-muted-foreground">
              {t("nativeAllowance.dialog.benefit")}
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 p-3 text-sm">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{t("nativeAllowance.dialog.oneWayWarning")}</span>
            </div>

            <div className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
              {t("nativeAllowance.dialog.dualLimitNote")}
            </div>

            <div className="space-y-2">
              <Label htmlFor="native-allowance-cap">
                {t("nativeAllowance.dialog.capLabel", { symbol })}
              </Label>
              <Input
                id="native-allowance-cap"
                type="text"
                inputMode="decimal"
                placeholder="0.0"
                value={amountCap}
                disabled={pending}
                onChange={(event) => setAmountCap(event.target.value)}
              />
              {amountCap.trim() !== "" && amountBase === null && (
                <p className="text-xs text-destructive">
                  {t("nativeAllowance.error.invalidAmount")}
                </p>
              )}
              {amountBase !== null && amountBase > 0n && target && (
                <p className="text-xs text-muted-foreground">
                  {t("nativeAllowance.dialog.capPreview", {
                    amount: formatBaseUnits(amountBase.toString(), target.decimals, locale),
                    symbol,
                  })}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="native-allowance-expiry">
                {t("nativeAllowance.dialog.expiryLabel")}
              </Label>
              <Input
                id="native-allowance-expiry"
                type="datetime-local"
                value={expiryLocal}
                disabled={pending}
                onChange={(event) => setExpiryLocal(event.target.value)}
              />
              {!expiryInFuture && expiryLocal && (
                <p className="text-xs text-destructive">{t("nativeAllowance.error.expiryPast")}</p>
              )}
            </div>

            {enable.error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span className="break-words">{enable.error.message}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t(result ? "common.close" : "common.cancel")}
          </Button>
          {!result && (
            <Button onClick={submit} disabled={pending || !valid}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending ? t("nativeAllowance.confirming") : t("nativeAllowance.signAndEnable")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "num text-xs" : "num font-medium"}>{value}</span>
    </div>
  );
}
