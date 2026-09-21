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
import { useTranslation } from "@/i18n/locale-provider";
import { explorerUrl } from "@/lib/solana";
import { copyToClipboard, formatMoney, moneyTone, truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export default function TreasuryPage() {
  const { t } = useTranslation();
  const { workflows, isLoading, balances, vaults } = useWorkflows();
  const { cluster } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const toast = useToast();

  return (
    <div>
      <PageHeader
        title={t("treasury.title")}
        description={t("treasury.description")}
        action={
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label={t("treasury.aria.refreshBalances")}
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
              {t("treasury.newVault")}
            </Button>
          </div>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title={t("treasury.emptyTitle")}
          description={t("treasury.emptyDescription")}
          action={{ label: t("treasury.createWorkflow"), onClick: () => setDialogOpen(true) }}
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
                          ok ? t("common.addressCopied") : t("common.couldNotCopy"),
                          ok ? "success" : "error",
                        );
                      }}
                    >
                      {truncateAddress(workflow.treasuryAddress, 6)}
                    </button>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t("treasury.noTreasuryConnected")}
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
                      {t("treasury.viewPolicySessions")}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      asChild
                      aria-label={t("treasury.aria.openInExplorer")}
                    >
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
                    <p className="text-xs text-muted-foreground">{t("treasury.setupHint")}</p>
                    <code className="block rounded bg-muted px-2 py-1 text-[11px] text-foreground">
                      pnpm agent-rails init --rpc &lt;url&gt;
                    </code>
                    <div className="flex gap-2 opacity-50">
                      <Button variant="outline" size="sm" className="flex-1" disabled>
                        <ArrowDownLeft className="h-3.5 w-3.5" />
                        {t("common.deposit")}
                      </Button>
                      <Button variant="outline" size="sm" className="flex-1" disabled>
                        <ArrowUpRight className="h-3.5 w-3.5" />
                        {t("common.withdraw")}
                      </Button>
                    </div>
                  </div>
                )}

                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline">
                    {t("common.agentsCount", { count: workflow.agents.length })}
                  </Badge>
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
