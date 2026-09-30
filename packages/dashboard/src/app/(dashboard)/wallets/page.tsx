"use client";

import { Copy, ExternalLink, Loader2, WalletIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { ExternalWalletCard } from "@/components/wallet/external-wallet-card";
import { PlatformWalletCard } from "@/components/wallet/platform-wallet-card";
import { useWallets } from "@/hooks/use-dashboard";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import { explorerUrl } from "@/lib/solana";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import type { WalletInfo } from "@/lib/types";
import { copyToClipboard, formatMoney, formatUsd, moneyTone, truncateAddress } from "@/lib/utils";
import { useAppStore, useBalancesHidden } from "@/stores/app-store";

const typeConfig = {
  treasury: { labelKey: "wallets.section.vault", variant: "default" as const },
  agent: { labelKey: "wallets.section.agent", variant: "secondary" as const },
  owner: { labelKey: "wallets.section.yourWallet", variant: "outline" as const },
};

function walletDisplayName(
  wallet: WalletInfo,
  t: (key: string, params?: Record<string, string | number>) => string,
): string {
  switch (wallet.type) {
    case "treasury":
      return t("wallets.vaultName", { name: wallet.workflowName });
    case "agent":
      return `${wallet.agentName} — ${wallet.agentRole ?? ""}`;
    case "owner":
      return wallet.ownerWalletName
        ? t("wallets.yourWalletNamed", { name: wallet.ownerWalletName })
        : t("wallets.yourWallet");
  }
}

export default function WalletsPage() {
  const { t, locale } = useTranslation();
  const { wallets, isLoading } = useWallets();
  const { cluster } = useAppStore();
  const hidden = useBalancesHidden();
  const toast = useToast();
  const intl = intlLocale(locale);

  const copy = async (address: string) => {
    const ok = await copyToClipboard(address);
    toast(ok ? t("common.addressCopied") : t("common.couldNotCopy"), ok ? "success" : "error");
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader wallet title={t("wallets.title")} description={t("wallets.descriptionShort")} />
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader wallet title={t("wallets.title")} description={t("wallets.descriptionLong")} />

      {/* Moved from Account: the customer path shows no wallets, the operator's does. */}
      <div className="mb-6 grid gap-4 md:grid-cols-2">
        {isSupabaseConfigured() && <PlatformWalletCard />}
        <ExternalWalletCard />
      </div>

      {wallets.length === 0 && (
        <EmptyState
          icon={WalletIcon}
          title={t("wallets.emptyTitle")}
          description={t("wallets.emptyDescription")}
        />
      )}

      {(["treasury", "agent", "owner"] as const).map((type) => {
        const rows = wallets.filter((w) => w.type === type);
        if (rows.length === 0) return null;
        const config = typeConfig[type];

        return (
          <section key={type} className="mb-8">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {t(config.labelKey)}
            </h2>
            <div className="grid gap-3">
              {rows.map((wallet) => (
                <Card key={wallet.id}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{walletDisplayName(wallet, t)}</span>
                        <Badge variant={config.variant}>{t(config.labelKey)}</Badge>
                      </div>
                      <p className="num text-xs text-muted-foreground">
                        {wallet.address
                          ? truncateAddress(wallet.address, 6)
                          : t("common.notProvisioned")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("wallets.workflowLine", {
                          name: wallet.workflowName || t("common.all"),
                        })}
                        {wallet.agentName &&
                          ` · ${t("wallets.agentLine", { name: wallet.agentName })}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className={`num text-lg font-semibold ${moneyTone(wallet.balance)}`}>
                          {formatMoney(wallet.balance, hidden, intl)}
                        </p>
                        {(wallet.balance.kind === "chain" || wallet.balance.kind === "token") &&
                          wallet.balance.usd !== null && (
                            <p className="num text-xs text-muted-foreground">
                              {formatUsd(wallet.balance.usd, intl, hidden)}
                            </p>
                          )}
                        {/* A vault whose headline is a stablecoin still needs SOL
                            for signatures, so the fee balance keeps its own line. */}
                        {wallet.secondary && (
                          <p className="num text-xs text-faint-foreground">
                            {formatMoney(wallet.secondary, hidden, intl)}{" "}
                            <span className="text-[11px]">{t("wallets.vaultFeeBalance")}</span>
                          </p>
                        )}
                        {type === "treasury" &&
                          !wallet.secondary &&
                          wallet.balance.kind === "chain" && (
                            <p className="text-[11px] text-faint-foreground">
                              {t("wallets.solVaultBalance")}
                            </p>
                          )}
                        {wallet.dailyLimitUsd !== undefined && wallet.dailyLimitUsd > 0 && (
                          <p className="num num-col text-xs text-muted-foreground">
                            {t("common.todayLimit")}:{" "}
                            {t("common.remaining", {
                              amount: formatUsd(
                                Math.max(wallet.dailyLimitUsd - (wallet.dailySpentUsd ?? 0), 0),
                                intl,
                              ),
                            })}
                          </p>
                        )}
                      </div>

                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={t("wallets.aria.copyAddress")}
                          disabled={!wallet.address}
                          onClick={() => wallet.address && copy(wallet.address)}
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                        {wallet.address && (
                          <Button
                            variant="ghost"
                            size="icon"
                            asChild
                            aria-label={t("wallets.aria.openInExplorer")}
                          >
                            <a
                              href={explorerUrl(wallet.address, cluster)}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
