"use client";

import { Menu, Shield } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConnectButton } from "@/components/wallet/connect-button";
import { CLUSTER_LABELS } from "@/lib/solana";
import type { OperationMode, SolanaCluster } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

/**
 * Mainnet is the only one where a mistake costs real money, so it is the only
 * one that gets an alarming colour. Devnet and testnet stay quiet.
 */
const clusterVariants: Record<SolanaCluster, "secondary" | "outline" | "destructive"> = {
  devnet: "outline",
  testnet: "secondary",
  "mainnet-beta": "destructive",
};

export function Header() {
  const {
    cluster,
    operationMode,
    googleEmail,
    sidebarCollapsed,
    setCluster,
    setOperationMode,
    setSidebarCollapsed,
  } = useAppStore();

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-card/50 px-4 backdrop-blur-sm">
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
          <span className="hidden font-semibold sm:inline">Agent Rails</span>
        </div>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        <Select value={cluster} onValueChange={(v) => setCluster(v as SolanaCluster)}>
          <SelectTrigger className="h-8 w-[110px] border-0 bg-transparent">
            <Badge variant={clusterVariants[cluster]} className="cursor-pointer">
              {CLUSTER_LABELS[cluster]}
            </Badge>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="devnet">Devnet</SelectItem>
            <SelectItem value="testnet">Testnet</SelectItem>
            <SelectItem value="mainnet-beta">Mainnet</SelectItem>
          </SelectContent>
        </Select>

        <Select value={operationMode} onValueChange={(v) => setOperationMode(v as OperationMode)}>
          <SelectTrigger className="hidden h-8 w-[168px] whitespace-nowrap sm:flex">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="native">Solana Nativo</SelectItem>
            <SelectItem value="agent-rails">Agent Rails Vault</SelectItem>
          </SelectContent>
        </Select>

        {googleEmail && (
          <span className="hidden text-xs text-muted-foreground md:inline">{googleEmail}</span>
        )}

        <ConnectButton />
      </div>
    </header>
  );
}
