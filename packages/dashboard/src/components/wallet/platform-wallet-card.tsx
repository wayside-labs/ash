"use client";

import { AlertTriangle, ArrowRight, Copy, Loader2, RefreshCw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useAccountWallet, useRetryProvisioning } from "@/hooks/use-account-wallet";
import { useBalances, useSolPrice } from "@/hooks/use-dashboard";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import { LAMPORTS_PER_SOL } from "@/lib/solana";
import { copyToClipboard, formatUsd, HIDDEN_AMOUNT, truncateAddress } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";

/**
 * The first thing a signed-in account sees about money (ADR-024): one balance, in dollars, and
 * a way into the detail. No cluster names, no key talk — those live one click further in.
 *
 * A `custody: "none"` wallet is the development stub. Its address is real and can receive
 * funds, but no key exists to move them out, so the card shows the balance and a warning and
 * never offers to copy the address as a deposit target.
 */
export function PlatformWalletCard() {
  const { t, locale } = useTranslation();
  const intl = intlLocale(locale);
  const toast = useToast();
  const hidden = useBalancesHidden();
  const { data, isLoading } = useAccountWallet();
  const retry = useRetryProvisioning();
  const wallet = data?.platformWallet ?? null;
  const { byAddress, isFetching } = useBalances([wallet?.publicKey]);
  const { data: price } = useSolPrice();

  const lamports = wallet ? byAddress.get(wallet.publicKey) : undefined;
  const sol = lamports === undefined ? null : lamports / LAMPORTS_PER_SOL;
  const usd = sol === null || price === undefined ? null : sol * price.usd;
  const keyless = wallet?.custody === "none";

  return (
    <Card data-testid="platform-wallet-card">
      <CardHeader>
        <CardTitle>{t("account.platformWallet.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : !wallet ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("account.platformWallet.pending")}</p>
            <Button
              variant="outline"
              size="sm"
              disabled={retry.isPending}
              onClick={() =>
                retry.mutate(undefined, {
                  onError: (error) => toast(error.message, "error"),
                })
              }
            >
              {retry.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t("account.platformWallet.retry")}
            </Button>
          </div>
        ) : (
          <>
            <div>
              <p className="text-xs text-muted-foreground">{t("account.platformWallet.balance")}</p>
              <p className="num text-3xl font-semibold" data-testid="platform-wallet-balance">
                {usd === null
                  ? isFetching
                    ? "…"
                    : hidden
                      ? HIDDEN_AMOUNT
                      : "—"
                  : formatUsd(usd, intl, hidden)}
              </p>
              {sol !== null && !hidden && (
                <p className="num text-xs text-muted-foreground">
                  {t("account.platformWallet.sol", { amount: sol.toFixed(4) })}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="num text-xs text-muted-foreground">
                {truncateAddress(wallet.publicKey, 6)}
              </p>
              {!keyless && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const ok = await copyToClipboard(wallet.publicKey);
                    toast(
                      ok ? t("common.addressCopied") : t("common.couldNotCopy"),
                      ok ? "success" : "error",
                    );
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t("account.platformWallet.copyToReceive")}
                </Button>
              )}
            </div>

            {keyless && (
              <div
                className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3"
                data-testid="platform-wallet-keyless"
              >
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  {t("account.platformWallet.keylessWarning")}
                </p>
              </div>
            )}

            <Button asChild variant="outline" size="sm">
              <Link href="/wallets">
                {t("account.platformWallet.viewActivity")}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
