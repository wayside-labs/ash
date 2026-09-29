"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Vault,
  Wallet,
} from "lucide-react";
import { useState } from "react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { BootstrapWizard } from "@/components/treasury/bootstrap-wizard";
import { TreasuryDetail } from "@/components/treasury/treasury-detail";
import { VaultTransferDialog } from "@/components/treasury/vault-transfer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { CreateWorkflowDialog } from "@/components/workflows/workflow-dialogs";
import { useWorkflows } from "@/hooks/use-dashboard";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import type { VaultTransferKind } from "@/lib/server/solana";
import { explorerUrl } from "@/lib/solana";
import { copyToClipboard, formatMoney, formatUsd, moneyTone, truncateAddress } from "@/lib/utils";
import { useAppStore, useBalancesHidden } from "@/stores/app-store";

export default function TreasuryPage() {
  const { t, locale } = useTranslation();
  const { workflows, isLoading, balances, vaults } = useWorkflows();
  const { cluster, walletAddress } = useAppStore();
  const hidden = useBalancesHidden();
  const intl = intlLocale(locale);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [bootstrapFor, setBootstrapFor] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<{ kind: VaultTransferKind; treasury: string } | null>(
    null,
  );
  const toast = useToast();

  const transferWorkflow = transfer
    ? workflows.find((w) => w.treasuryAddress === transfer.treasury)
    : undefined;
  const bootstrapWorkflow = workflows.find((w) => w.id === bootstrapFor) ?? null;

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
          {workflows.map((workflow) => {
            const vault = workflow.treasuryAddress
              ? vaults.vaultByTreasury.get(workflow.treasuryAddress)
              : undefined;
            // The on-chain owner, not the address the workflow row claims —
            // the program is the only authority on who may withdraw.
            const isOwner = Boolean(walletAddress) && vault?.owner === walletAddress;
            return (
              // Keyed by treasury rather than by workflow id, so the UI suite
              // can address the card whose vault it stubbed.
              <Card
                key={workflow.id}
                {...(workflow.treasuryAddress
                  ? { "data-testid": `vault-${workflow.treasuryAddress}` }
                  : {})}
              >
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
                      {formatMoney(workflow.balance, hidden, intl)}
                    </p>
                    {workflow.balance.kind !== "unknown" &&
                      workflow.balance.kind !== "demo" &&
                      workflow.balance.usd !== null && (
                        <p className="num text-sm text-muted-foreground">
                          {formatUsd(workflow.balance.usd, intl, hidden)}
                        </p>
                      )}
                    {/* Every other mint the treasury holds, SOL included when it is
                        not the headline — the fee balance is not optional context. */}
                    {workflow.assets
                      .filter((asset) => asset.mint !== workflow.primaryMint)
                      .map((asset) => (
                        <p key={asset.mint} className="num text-xs text-faint-foreground">
                          {formatMoney(asset.money, hidden, intl)}
                        </p>
                      ))}
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
                    <div className="space-y-2">
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          disabled={!walletAddress}
                          onClick={() =>
                            setTransfer({
                              kind: "deposit",
                              treasury: workflow.treasuryAddress as string,
                            })
                          }
                        >
                          <ArrowDownLeft className="h-3.5 w-3.5" />
                          {t("common.deposit")}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex-1"
                          disabled={!isOwner}
                          onClick={() =>
                            setTransfer({
                              kind: "withdraw",
                              treasury: workflow.treasuryAddress as string,
                            })
                          }
                        >
                          <ArrowUpRight className="h-3.5 w-3.5" />
                          {t("common.withdraw")}
                        </Button>
                      </div>

                      {!walletAddress ? (
                        <p className="text-xs text-muted-foreground">
                          {t("treasury.connectWalletToMoveFunds")}
                        </p>
                      ) : !isOwner ? (
                        <p className="text-xs text-muted-foreground">
                          {t("treasury.withdrawOwnerOnly")}
                        </p>
                      ) : null}

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
                    </div>
                  ) : (
                    <div className="space-y-2 rounded-lg border border-dashed border-border p-3">
                      <p className="text-xs text-muted-foreground">{t("treasury.setupHint")}</p>
                      {/* Demo rows have no chain to write to; a bootstrap there would
                          create a real treasury behind a pretend balance. */}
                      <Button
                        size="sm"
                        className="w-full"
                        disabled={!walletAddress || workflow.demo}
                        onClick={() => setBootstrapFor(workflow.id)}
                      >
                        <Vault className="h-3.5 w-3.5" />
                        {t("treasury.bootstrap.cta")}
                      </Button>
                      {!walletAddress && (
                        <p className="text-xs text-muted-foreground">
                          {t("treasury.bootstrap.connectWallet")}
                        </p>
                      )}
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
            );
          })}
        </div>
      )}

      <CreateWorkflowDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <TreasuryDetail
        address={detail}
        onClose={() => setDetail(null)}
        onFinishSetup={(treasury) => {
          const owner = workflows.find((w) => w.treasuryAddress === treasury);
          if (!owner) return;
          setDetail(null);
          setBootstrapFor(owner.id);
        }}
      />
      <BootstrapWizard workflow={bootstrapWorkflow} onClose={() => setBootstrapFor(null)} />
      <VaultTransferDialog
        kind={transfer?.kind ?? null}
        treasury={transfer?.treasury ?? null}
        assets={transferWorkflow?.assets ?? []}
        defaultMint={transferWorkflow?.primaryMint ?? null}
        ownerTokenByMint={vaults.ownerTokenByMint}
        walletLamports={walletAddress ? (balances.byAddress.get(walletAddress) ?? null) : null}
        rentExemptMinimum={vaults.rentExemptMinimum}
        onClose={() => setTransfer(null)}
      />
    </div>
  );
}
