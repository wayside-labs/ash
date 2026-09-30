"use client";

import { Link2, Loader2, Lock, LogOut, Unlink } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useAccountWallet, useLinkWallet, useUnlinkWallet } from "@/hooks/use-account-wallet";
import { useTranslation } from "@/i18n/locale-provider";
import { truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { ConnectButton } from "./connect-button";
import { WalletSetupPrompt } from "./wallet-setup-prompt";

/**
 * Self-custody wallets (ADR-024). Pro only in hosted mode; the copy on both sides of the gate
 * says who holds which key, because "connect a wallet" means nothing to someone who does not
 * yet know the platform wallet is not the same thing.
 */
export function ExternalWalletCard() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data } = useAccountWallet();
  const { walletAddress, walletName, setWallet } = useAppStore();
  const link = useLinkWallet();
  const unlink = useUnlinkWallet();
  // Lifted so the post-login offer can open this card's picker directly.
  const [pickerOpen, setPickerOpen] = useState(false);

  if (!data) return null;

  if (!data.externalWallets) {
    return (
      <Card data-testid="external-wallet-locked">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4" />
            {t("account.external.title")}
            <Badge variant="secondary">{t("account.external.proBadge")}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <CustodyExplainer />
          <p className="text-xs text-muted-foreground">{t("account.external.lockedHint")}</p>
        </CardContent>
      </Card>
    );
  }

  const linked = new Set(data.linkedWallets.map((w) => w.address));
  const canLink = data.hosted && data.accountId !== null;

  return (
    <Card data-testid="external-wallet-card">
      <WalletSetupPrompt onConnect={() => setPickerOpen(true)} />
      <CardHeader>
        <CardTitle>{t("account.external.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <CustodyExplainer />

        {walletAddress ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("account.connectedWallet")}</p>
              <p className="num text-sm">{truncateAddress(walletAddress, 8)}</p>
              {walletName && <p className="text-xs text-muted-foreground">{walletName}</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {canLink && !linked.has(walletAddress) && data.accountId && (
                <Button
                  size="sm"
                  disabled={link.isPending}
                  onClick={() =>
                    link.mutate(
                      {
                        accountId: data.accountId as string,
                        address: walletAddress,
                        walletName: walletName ?? "",
                      },
                      {
                        onSuccess: () => toast(t("account.external.linked"), "success"),
                        onError: (error) => {
                          if (!/user rejected|denied|cancel/i.test(error.message)) {
                            toast(error.message, "error");
                          }
                        },
                      },
                    )
                  }
                >
                  {link.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Link2 className="h-3.5 w-3.5" />
                  )}
                  {t("account.external.link")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setWallet(null);
                  toast(t("common.walletDisconnected"));
                }}
              >
                <LogOut className="h-3.5 w-3.5" />
                {t("common.disconnect")}
              </Button>
            </div>
          </div>
        ) : (
          <ConnectButton pickerOpen={pickerOpen} onPickerOpenChange={setPickerOpen} />
        )}

        {data.linkedWallets.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">{t("account.external.linkedTitle")}</p>
            {data.linkedWallets.map((wallet) => (
              <div key={wallet.address} className="flex items-center justify-between gap-2">
                <span className="num text-sm">
                  {truncateAddress(wallet.address, 6)}
                  {wallet.walletName && (
                    <span className="ml-2 text-xs text-muted-foreground">{wallet.walletName}</span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("account.external.unlink")}
                  disabled={unlink.isPending}
                  onClick={() =>
                    unlink.mutate(wallet.address, {
                      onError: (error) => toast(error.message, "error"),
                    })
                  }
                >
                  <Unlink className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CustodyExplainer() {
  const { t } = useTranslation();
  return (
    <dl className="grid gap-2 text-xs">
      <div>
        <dt className="font-medium">{t("account.external.platformTitle")}</dt>
        <dd className="text-muted-foreground">{t("account.external.platformBody")}</dd>
      </div>
      <div>
        <dt className="font-medium">{t("account.external.selfTitle")}</dt>
        <dd className="text-muted-foreground">{t("account.external.selfBody")}</dd>
      </div>
    </dl>
  );
}
