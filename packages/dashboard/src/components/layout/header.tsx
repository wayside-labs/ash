"use client";

import { Menu, Shield } from "lucide-react";
import { BalancePill } from "@/components/billing/balance-pill";
import { HideBalancesToggle } from "@/components/shared/hide-balances-toggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { GatedConnectButton } from "@/components/wallet/gated-connect-button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useTranslation } from "@/i18n/locale-provider";
import { CLUSTER_LABELS } from "@/lib/solana";
import type { SolanaCluster } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

const clusterVariants: Record<SolanaCluster, "secondary" | "outline" | "destructive"> = {
  devnet: "outline",
  testnet: "secondary",
  "mainnet-beta": "destructive",
};

/**
 * The top bar of a web3 dapp: which network, the client's credit with Deposit and Withdraw,
 * and the wallet. The wallet is the signer for deposits, treasuries and sessions, so Connect
 * is here on every page rather than inside the pages that sign.
 */
export function Header() {
  const {
    cluster,
    setCluster,
    sidebarCollapsed,
    sidebarHidden,
    setSidebarCollapsed,
    setSidebarHidden,
  } = useAppStore();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const { t } = useTranslation();

  // One button, two behaviours: on desktop it folds the sidebar away, below `lg` it opens the
  // overlay drawer.
  const toggle = () =>
    desktop ? setSidebarHidden(!sidebarHidden) : setSidebarCollapsed(!sidebarCollapsed);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/50 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={t("header.toggleMenu")}
          aria-expanded={desktop ? !sidebarHidden : !sidebarCollapsed}
          data-testid="menu-toggle"
        >
          <Menu className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <span className="hidden font-semibold sm:inline">{t("header.brand")}</span>
        </div>
      </div>

      <div className="flex min-w-0 items-center gap-1 sm:gap-2">
        {/* The network is shown wherever a wallet is: signing on the wrong one is the classic
            web3 mistake. Hidden on phones, where Settings still sets it. */}
        <Select value={cluster} onValueChange={(v) => setCluster(v as SolanaCluster)}>
          <SelectTrigger
            className="hidden h-8 w-auto border-0 bg-transparent px-1 md:flex"
            aria-label={t("header.network")}
          >
            <Badge variant={clusterVariants[cluster]} className="cursor-pointer">
              {CLUSTER_LABELS[cluster]}
            </Badge>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="devnet">{CLUSTER_LABELS.devnet}</SelectItem>
            <SelectItem value="testnet">{CLUSTER_LABELS.testnet}</SelectItem>
            <SelectItem value="mainnet-beta">{CLUSTER_LABELS["mainnet-beta"]}</SelectItem>
          </SelectContent>
        </Select>
        <HideBalancesToggle />
        <BalancePill />
        <span className="hidden h-8 w-px bg-border sm:block" />
        <GatedConnectButton />
      </div>
    </header>
  );
}
