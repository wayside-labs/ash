"use client";

import { Menu, Shield } from "lucide-react";
import { usePathname } from "next/navigation";
import { BalancePill } from "@/components/billing/balance-pill";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { GatedConnectButton } from "@/components/wallet/gated-connect-button";
import { SolPriceTicker } from "@/components/wallet/sol-price-ticker";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "@/i18n/locale-provider";
import { isSimpleRoute, type ShellMode } from "@/lib/shell";
import { CLUSTER_LABELS } from "@/lib/solana";
import type { OperationMode, SolanaCluster } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

const clusterVariants: Record<SolanaCluster, "secondary" | "outline" | "destructive"> = {
  devnet: "outline",
  testnet: "secondary",
  "mainnet-beta": "destructive",
};

export function Header({ shellMode }: { shellMode: ShellMode }) {
  const simple = isSimpleRoute(usePathname(), shellMode);
  const {
    cluster,
    operationMode,
    sidebarCollapsed,
    setCluster,
    setOperationMode,
    setSidebarCollapsed,
  } = useAppStore();
  const { label: authLabel } = useAuth();
  const { t } = useTranslation();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/50 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          <Menu className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <span className="hidden font-semibold sm:inline">{t("header.brand")}</span>
        </div>
      </div>

      {simple ? (
        // The simple shell's money is chat credit. Cluster, mode, SOL price and the wallet
        // button are operator controls; they stay one click away on every advanced route.
        <div className="flex items-center gap-2 sm:gap-3">
          {authLabel && (
            <span className="hidden text-xs text-muted-foreground xl:inline">{authLabel}</span>
          )}
          <BalancePill />
        </div>
      ) : (
        <div className="flex items-center gap-2 sm:gap-3">
          <Select value={cluster} onValueChange={(v) => setCluster(v as SolanaCluster)}>
            <SelectTrigger className="h-8 w-[110px] border-0 bg-transparent">
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

          <Select value={operationMode} onValueChange={(v) => setOperationMode(v as OperationMode)}>
            <SelectTrigger className="hidden h-8 w-[168px] whitespace-nowrap lg:flex">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="native">{t("mode.native")}</SelectItem>
              <SelectItem value="agent-rails">{t("mode.agentRails")}</SelectItem>
            </SelectContent>
          </Select>

          {authLabel && (
            <span className="hidden text-xs text-muted-foreground xl:inline">{authLabel}</span>
          )}

          <span className="hidden h-8 w-px bg-border sm:block" />
          <SolPriceTicker />
          <GatedConnectButton />
        </div>
      )}
    </header>
  );
}
