"use client";

import { NATIVE_MINT } from "@agent-rails/contract/constants";
import { usdcMintFor } from "@agent-rails/contract/mints";
import { AmountConversionError, fromBaseUnits, toBaseUnits } from "@agent-rails/contract/units";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, ExternalLink, Loader2 } from "lucide-react";
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
import { useVaultTransfer, type VaultTransferResult } from "@/hooks/use-dashboard";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import type { OwnerTokenBalance, VaultTransferKind } from "@/lib/server/solana";
import { explorerTxUrl } from "@/lib/solana";
import type { VaultAsset } from "@/lib/types";
import { cn, formatToken, truncateAddress } from "@/lib/utils";
import { useAppStore, useBalancesHidden } from "@/stores/app-store";

/**
 * A deposit still has to pay for its own signature, so offering the whole
 * balance as "max" guarantees a failed transaction. 0.01 SOL clears a base fee
 * by three orders of magnitude and survives a busy-network priority bump.
 *
 * It applies to the SOL row only: an SPL deposit spends tokens, and the fee
 * comes out of a lamport balance the amount field never touches.
 */
const FEE_BUFFER_LAMPORTS = 10_000_000;

export type VaultTransferDialogProps = {
  kind: VaultTransferKind | null;
  treasury: string | null;
  /** Every mint this vault holds, native first-or-last as the treasury lists it. */
  assets: VaultAsset[];
  /** Mint to open on: the vault's headline asset. */
  defaultMint: string | null;
  ownerTokenByMint: Map<string, OwnerTokenBalance>;
  walletLamports: number | null;
  rentExemptMinimum: number;
  onClose: () => void;
};

export function VaultTransferDialog({
  kind,
  treasury,
  assets,
  defaultMint,
  ownerTokenByMint,
  walletLamports,
  rentExemptMinimum,
  onClose,
}: VaultTransferDialogProps) {
  const { t, locale } = useTranslation();
  const { cluster } = useAppStore();
  const intl = intlLocale(locale);
  const hidden = useBalancesHidden();
  const transfer = useVaultTransfer();
  const toast = useToast();
  const [amount, setAmount] = useState("");
  const [mint, setMint] = useState<string | null>(defaultMint);
  const [result, setResult] = useState<VaultTransferResult | null>(null);

  const open = kind !== null && treasury !== null;
  const isDeposit = kind === "deposit";

  // Every open is a fresh transfer; a stale amount, mint or receipt is a footgun.
  useEffect(() => {
    if (open) {
      setAmount("");
      setResult(null);
      setMint(defaultMint);
      transfer.reset();
    }
  }, [open, defaultMint, transfer.reset]);

  const asset = useMemo(
    () => assets.find((a) => a.mint === mint) ?? assets.find((a) => a.mint === NATIVE_MINT),
    [assets, mint],
  );

  /**
   * The largest amount this transfer could carry, in base units. Withdraw is
   * bounded by the vault; deposit by the wallet. The SOL floor is the program's
   * own rule — `withdraw` refuses to take `sol_vault` below rent exemption — so
   * subtracting it here is what makes the "max" button honest rather than a
   * transaction that simulates and fails.
   */
  const maxBase = useMemo(() => {
    if (!asset) return 0n;
    if (asset.mint === NATIVE_MINT) {
      const lamports = isDeposit
        ? Math.max((walletLamports ?? 0) - FEE_BUFFER_LAMPORTS, 0)
        : Math.max(Number(asset.raw) - rentExemptMinimum, 0);
      return BigInt(Math.floor(lamports));
    }
    if (isDeposit) return BigInt(ownerTokenByMint.get(asset.mint)?.amount ?? "0");
    return BigInt(asset.raw);
  }, [asset, isDeposit, walletLamports, rentExemptMinimum, ownerTokenByMint]);

  /**
   * Parsed with the mint's own decimals rather than a float multiply: "0.1" SOL
   * through `Number` is not 100000000 lamports, and excess precision denies
   * instead of quietly rounding into an amount nobody authorized.
   */
  const parsed = useMemo(() => {
    if (!asset || amount.trim() === "") return { base: null as bigint | null, error: null };
    try {
      return { base: toBaseUnits(amount.trim(), asset.decimals), error: null };
    } catch (error) {
      if (error instanceof AmountConversionError && error.reason === "PRECISION_EXCEEDS_MINT") {
        return {
          base: null,
          error: t("vaultTransfer.error.tooPrecise", {
            decimals: asset.decimals,
            symbol: asset.symbol,
          }),
        };
      }
      return { base: null, error: t("vaultTransfer.error.malformedAmount") };
    }
  }, [amount, asset, t]);

  const valid = parsed.base !== null && parsed.base > 0n;
  const overMax = valid && (parsed.base as bigint) > maxBase;
  const pending = transfer.isPending;

  /**
   * A deposit the agent path could never spend: a mint the treasury never
   * added, or one funded by an ADR-014 native allowance from the owner's own
   * wallet rather than from the vault.
   *
   * Withdraw is never gated on either — `withdraw` deliberately ignores
   * `Treasury.mints` so the owner can always reach funds they can see.
   */
  const depositWarning =
    !isDeposit || !asset
      ? null
      : !asset.configured
        ? t("vaultTransfer.error.mintNotConfigured", { symbol: asset.symbol })
        : asset.fundingMode !== "isolated-vault"
          ? t("vaultTransfer.error.mintNativeAllowance", { symbol: asset.symbol })
          : null;

  /**
   * Native SOL is warned about but never blocked: `sol_vault` takes
   * permissionless system transfers whether or not a mint slot was ever added
   * for it, and the owner can always withdraw again. Only the token path is
   * refused, which is exactly what the server refuses too.
   */
  const depositBlocked = depositWarning !== null && asset?.mint !== NATIVE_MINT;

  const usdcMint = usdcMintFor(cluster);
  const usdcMissing = usdcMint !== null && !assets.some((a) => a.mint === usdcMint);

  const show = (base: bigint) =>
    asset
      ? formatToken(
          Number(fromBaseUnits(base, asset.decimals)),
          asset.symbol,
          asset.decimals,
          false,
          intl,
        )
      : "—";

  async function submit() {
    if (!valid || overMax || depositBlocked || !treasury || !kind || !asset || !parsed.base) return;
    try {
      const outcome = await transfer.mutateAsync({
        kind,
        treasury,
        mint: asset.mint,
        amount: parsed.base,
      });
      setResult(outcome);
      toast(
        outcome.status === "confirmed"
          ? t(isDeposit ? "vaultTransfer.toast.deposited" : "vaultTransfer.toast.withdrew", {
              amount: show(parsed.base),
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
            {t(isDeposit ? "vaultTransfer.depositTitle" : "vaultTransfer.withdrawTitle", {
              symbol: asset?.symbol ?? "",
            })}
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
            {assets.length > 1 && (
              <div className="space-y-2">
                <Label>{t("vaultTransfer.assetLabel")}</Label>
                <div className="flex flex-wrap gap-2">
                  {assets.map((candidate) => (
                    <button
                      key={candidate.mint}
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        setMint(candidate.mint);
                        setAmount("");
                      }}
                      className={cn(
                        "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                        candidate.mint === asset?.mint
                          ? "border-foreground bg-muted text-foreground"
                          : "border-border text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {candidate.symbol}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-1 rounded-lg border border-border p-3 text-xs">
              <Row label={t("vaultTransfer.vault")} value={truncateAddress(asset?.vault, 6)} mono />
              <Row
                label={t("vaultTransfer.vaultBalance")}
                value={
                  asset
                    ? formatToken(asset.amount, asset.symbol, asset.decimals, hidden, intl)
                    : "—"
                }
              />
              <Row
                label={t(isDeposit ? "vaultTransfer.available" : "vaultTransfer.withdrawable")}
                value={hidden && asset ? formatToken(0, asset.symbol, 0, true) : show(maxBase)}
              />
            </div>

            {usdcMissing && (
              <p className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
                {t("vaultTransfer.usdcNotConfigured")}{" "}
                <code className="num text-foreground">
                  pnpm agent-rails init --mint {truncateAddress(usdcMint, 6)}
                </code>
              </p>
            )}

            <div className="space-y-2">
              <Label htmlFor="vault-transfer-amount">
                {t("vaultTransfer.amountLabel", { symbol: asset?.symbol ?? "" })}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="vault-transfer-amount"
                  type="text"
                  inputMode="decimal"
                  placeholder="0.0"
                  value={amount}
                  disabled={pending || depositBlocked}
                  onChange={(event) => setAmount(event.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={pending || depositBlocked || maxBase <= 0n || !asset}
                  onClick={() => asset && setAmount(fromBaseUnits(maxBase, asset.decimals))}
                >
                  {t("vaultTransfer.max")}
                </Button>
              </div>
              {parsed.error && <p className="text-xs text-destructive">{parsed.error}</p>}
              {overMax && (
                <p className="text-xs text-destructive">
                  {t("vaultTransfer.error.overMax", { max: show(maxBase) })}
                </p>
              )}
              {depositWarning && <p className="text-xs text-warning">{depositWarning}</p>}
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
            <Button onClick={submit} disabled={pending || !valid || overMax || depositBlocked}>
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
