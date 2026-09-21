"use client";

import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ExternalLink, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
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
import { useVaultTransfer, type VaultTransferResult } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import type { VaultTransferKind } from "@/lib/server/solana";
import { explorerTxUrl, LAMPORTS_PER_SOL } from "@/lib/solana";
import { formatSol, truncateAddress } from "@/lib/utils";
import { useAppStore, useBalancesHidden } from "@/stores/app-store";

/**
 * A deposit still has to pay for its own signature, so offering the whole
 * balance as "max" guarantees a failed transaction. 0.01 SOL clears a base fee
 * by three orders of magnitude and survives a busy-network priority bump.
 */
const FEE_BUFFER_LAMPORTS = 10_000_000;

export type VaultTransferDialogProps = {
  kind: VaultTransferKind | null;
  treasury: string | null;
  solVault: string | null;
  vaultLamports: number | null;
  walletLamports: number | null;
  rentExemptMinimum: number;
  onClose: () => void;
};

export function VaultTransferDialog({
  kind,
  treasury,
  solVault,
  vaultLamports,
  walletLamports,
  rentExemptMinimum,
  onClose,
}: VaultTransferDialogProps) {
  const { t } = useTranslation();
  const { cluster } = useAppStore();
  const hidden = useBalancesHidden();
  const transfer = useVaultTransfer();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [result, setResult] = useState<VaultTransferResult | null>(null);

  const open = kind !== null && treasury !== null;

  // Every open is a fresh transfer; a stale amount or receipt would be a footgun.
  useEffect(() => {
    if (open) {
      setAmount("");
      setResult(null);
      transfer.reset();
    }
  }, [open, transfer.reset]);

  const isDeposit = kind === "deposit";
  // Withdraw cannot take the vault below the program's rent-exempt floor, and a
  // deposit cannot spend the lamports that pay for its own fee.
  const availableLamports = isDeposit
    ? Math.max((walletLamports ?? 0) - FEE_BUFFER_LAMPORTS, 0)
    : Math.max((vaultLamports ?? 0) - rentExemptMinimum, 0);
  const maxSol = availableLamports / LAMPORTS_PER_SOL;

  const parsed = Number(amount);
  const valid = amount.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
  const overMax = valid && parsed > maxSol;
  const pending = transfer.isPending;

  async function submit() {
    if (!valid || overMax || !treasury || !kind) return;
    // Round-trip through lamports so 0.1 SOL never lands as 99999999.
    const lamports = BigInt(Math.round(parsed * LAMPORTS_PER_SOL));
    try {
      const outcome = await transfer.mutateAsync({ kind, treasury, lamports });
      setResult(outcome);
      toast(
        outcome.status === "confirmed"
          ? t(isDeposit ? "vaultTransfer.toast.deposited" : "vaultTransfer.toast.withdrew", {
              amount: formatSol(parsed),
              signature: truncateAddress(outcome.signature, 6),
            })
          : t("vaultTransfer.toast.pending", {
              signature: truncateAddress(outcome.signature, 6),
            }),
        outcome.status === "confirmed" ? "success" : "error",
      );
    } catch {
      // Rendered inline below; the mutation holds the message.
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isDeposit ? (
              <ArrowDownLeft className="h-4 w-4 text-good" />
            ) : (
              <ArrowUpRight className="h-4 w-4 text-warning" />
            )}
            {t(isDeposit ? "vaultTransfer.depositTitle" : "vaultTransfer.withdrawTitle")}
          </DialogTitle>
          <DialogDescription>
            {t(
              isDeposit ? "vaultTransfer.depositDescription" : "vaultTransfer.withdrawDescription",
            )}
          </DialogDescription>
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
                    ? "vaultTransfer.confirmedTitle"
                    : "vaultTransfer.timeoutTitle",
                )}
              </p>
              <p className="num mt-1 break-all text-xs text-muted-foreground">{result.signature}</p>
            </div>
            <Button variant="outline" className="w-full" asChild>
              <a href={explorerTxUrl(result.signature, cluster)} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                {t("vaultTransfer.viewOnExplorer")}
              </a>
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-1 rounded-lg border border-border p-3 text-xs">
              <Row label={t("vaultTransfer.vault")} value={truncateAddress(solVault, 6)} mono />
              <Row
                label={t("vaultTransfer.vaultBalance")}
                value={
                  vaultLamports === null ? "—" : formatSol(vaultLamports / LAMPORTS_PER_SOL, hidden)
                }
              />
              <Row
                label={t(isDeposit ? "vaultTransfer.available" : "vaultTransfer.withdrawable")}
                value={formatSol(maxSol, hidden)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="vault-transfer-amount">{t("vaultTransfer.amountLabel")}</Label>
              <div className="flex gap-2">
                <Input
                  id="vault-transfer-amount"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.000000001"
                  placeholder="0.0"
                  value={amount}
                  disabled={pending}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || maxSol <= 0}
                  onClick={() => setAmount(String(maxSol))}
                >
                  {t("vaultTransfer.max")}
                </Button>
              </div>
              {overMax && (
                <p className="text-xs text-destructive">
                  {t("vaultTransfer.error.overMax", { max: formatSol(maxSol) })}
                </p>
              )}
            </div>

            {transfer.error && (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <span className="break-words">{transfer.error.message}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={pending}>
            {t(result ? "common.close" : "common.cancel")}
          </Button>
          {!result && (
            <Button onClick={submit} disabled={pending || !valid || overMax}>
              {pending && <Loader2 className="h-4 w-4 animate-spin" />}
              {pending
                ? t("vaultTransfer.confirming")
                : t(isDeposit ? "common.deposit" : "common.withdraw")}
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
      <span className={mono ? "num" : "num font-medium"}>{value}</span>
    </div>
  );
}
