"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { TreasuryDetail } from "@/components/treasury/treasury-detail";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { CreateWorkflowDialog } from "@/components/workflows/workflow-dialogs";
import { useWorkflows } from "@/hooks/use-dashboard";
import { explorerUrl } from "@/lib/solana";
import { copyToClipboard, formatMoney, moneyTone, truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export default function TreasuryPage() {
  const { workflows, isLoading, balances, vaults } = useWorkflows();
  const { cluster } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const toast = useToast();

  return (
    <div>
      <PageHeader
        title="Treasury"
        description="Cofres e fundos de cada workflow"
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Atualizar saldos"
              onClick={() => {
                balances.refetch();
                vaults.refetch();
              }}
              disabled={balances.isFetching || vaults.isFetching}
            >
              <RefreshCw
                className={
                  balances.isFetching || vaults.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"
                }
              />
            </Button>
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              Novo Cofre
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="Nenhum cofre"
          description="Cada workflow tem um cofre. Crie um workflow para começar."
          action={{ label: "Criar workflow", onClick: () => setDialogOpen(true) }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workflows.map((workflow) => (
            <Card key={workflow.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="text-2xl">{workflow.icon}</span>
                    <CardTitle className="truncate">{workflow.name}</CardTitle>
                  </div>
                  {workflow.demo && <DemoBadge />}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className={`num text-2xl font-bold ${moneyTone(workflow.balance)}`}>
                    {formatMoney(workflow.balance)}
                  </p>
                  {workflow.treasuryAddress ? (
                    <button
                      type="button"
                      className="mt-1 flex items-center gap-1 num text-xs text-muted-foreground transition-colors hover:text-foreground"
                      onClick={async () => {
                        const ok = await copyToClipboard(workflow.treasuryAddress as string);
                        toast(
                          ok ? "Endereço copiado." : "Não foi possível copiar.",
                          ok ? "success" : "error",
                        );
                      }}
                    >
                      {truncateAddress(workflow.treasuryAddress, 6)}
                    </button>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Sem treasury on-chain conectada
                    </p>
                  )}
                </div>

                {workflow.treasuryAddress ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => setDetail(workflow.treasuryAddress)}
                    >
                      Ver política e sessões
                    </Button>
                    <Button variant="ghost" size="icon" asChild aria-label="Abrir no explorer">
                      <a
                        href={explorerUrl(workflow.treasuryAddress, cluster)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                    <p className="text-xs text-muted-foreground">
                      Depositar e sacar movem fundos reais e exigem a assinatura do dono. Crie a
                      treasury pelo CLI e conecte o endereço a este workflow:
                    </p>
                    <code className="block rounded bg-muted px-2 py-1 text-[11px] text-foreground">
                      pnpm agent-rails init --rpc &lt;url&gt;
                    </code>
                    <div className="flex gap-2 opacity-50">
                      <Button variant="outline" size="sm" className="flex-1" disabled>
                        <ArrowDownLeft className="h-3.5 w-3.5" />
                        Depositar
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1" disabled>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        Sacar
                      </Button>
                    </div>
                  </div>
                )}

                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">{workflow.agents.length} agentes</Badge>
                  <Badge variant="outline">{workflow.cluster}</Badge>
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateWorkflowDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <TreasuryDetail address={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
