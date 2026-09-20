"use client";

import { Copy, ExternalLink, Loader2, WalletIcon } from "lucide-react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { useWallets } from "@/hooks/use-dashboard";
import { explorerUrl } from "@/lib/solana";
import { copyToClipboard, formatMoney, formatUsd, moneyTone, truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

const typeLabels = {
  treasury: { label: "Cofre", variant: "default" as const },
  agent: { label: "Agente", variant: "secondary" as const },
  owner: { label: "Sua Wallet", variant: "outline" as const },
};

export default function WalletsPage() {
  const { wallets, isLoading } = useWallets();
  const { cluster } = useAppStore();
  const toast = useToast();

  const copy = async (address: string) => {
    const ok = await copyToClipboard(address);
    toast(ok ? "Endereço copiado." : "Não foi possível copiar.", ok ? "success" : "error");
  };

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Wallets" description="Carteiras, cofres e endereços organizados" />
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Wallets"
        description="Carteiras, cofres e endereços organizados. Saldos vêm da rede selecionada."
      />

      {wallets.length === 0 && (
        <EmptyState
          icon={WalletIcon}
          title="Nada para mostrar"
          description="Conecte sua carteira no topo ou crie um workflow para ver os endereços aqui."
        />
      )}

      {(["treasury", "agent", "owner"] as const).map((type) => {
        const rows = wallets.filter((w) => w.type === type);
        if (rows.length === 0) return null;

        return (
          <section key={type} className="mb-8">
            <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              {typeLabels[type].label}
            </h2>
            <div className="grid gap-3">
              {rows.map((wallet) => (
                <Card key={wallet.id}>
                  <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{wallet.name}</span>
                        <Badge variant={typeLabels[type].variant}>{typeLabels[type].label}</Badge>
                      </div>
                      <p className="num text-xs text-muted-foreground">
                        {wallet.address ? truncateAddress(wallet.address, 6) : "não provisionada"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Workflow: {wallet.workflowName}
                        {wallet.agentName && ` · Agente: ${wallet.agentName}`}
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="text-right">
                        <p className={`num text-lg font-semibold ${moneyTone(wallet.balance)}`}>
                          {formatMoney(wallet.balance)}
                        </p>
                        {type === "treasury" && wallet.balance.kind === "chain" && (
                          <p className="text-[11px] text-faint-foreground">saldo do cofre de SOL</p>
                        )}
                        {wallet.dailyLimitUsd !== undefined && wallet.dailyLimitUsd > 0 && (
                          <p className="num num-col text-xs text-muted-foreground">
                            Limite hoje:{" "}
                            {formatUsd(
                              Math.max(wallet.dailyLimitUsd - (wallet.dailySpentUsd ?? 0), 0),
                            )}{" "}
                            restante
                          </p>
                        )}
                      </div>

                      <div className="flex gap-1">
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label="Copiar endereço"
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
                            aria-label="Abrir no explorer"
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
