"use client";

import {
  ArrowDownLeft,
  ArrowUpRight,
  Brain,
  Cable,
  Download,
  ExternalLink,
  Gauge,
  Loader2,
  Package,
  Pause,
  Play,
  Settings2,
  Trash2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { VaultTransferDialog } from "@/components/treasury/vault-transfer-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import { CeilingMeter } from "@/components/viz/ceiling-meter";
import {
  useDashboardState,
  useDeleteResource,
  useExportRunnerConfig,
  useUpdateResource,
  useWorkflows,
} from "@/hooks/use-dashboard";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import { isPayingAgent } from "@/lib/agent-wallet";
import { runnerBundleFilename, runnerConfigFilename } from "@/lib/mcp-config";
import { isLikelyAddress } from "@/lib/schema";
import { appliesToAgent, scopeBadgeLabel } from "@/lib/scope";
import type { VaultTransferKind } from "@/lib/server/solana";
import { explorerUrl } from "@/lib/solana";
import type { Agent, Workflow } from "@/lib/types";
import { cn, formatMoney, formatUsd, moneyTone, truncateAddress } from "@/lib/utils";
import { useAppStore, useBalancesHidden } from "@/stores/app-store";

function isMalformedAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed !== "" && !isLikelyAddress(trimmed);
}

export function AgentSettingsSheet({
  agent,
  workflow,
  open,
  onOpenChange,
}: {
  agent: Agent;
  workflow: Workflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, locale } = useTranslation();
  const hidden = useBalancesHidden();
  const { cluster, walletAddress } = useAppStore();
  const { balances, vaults } = useWorkflows();
  const state = useDashboardState();
  const updateAgent = useUpdateResource("agents");
  const removeAgent = useDeleteResource("agents");
  const updateMcp = useUpdateResource("mcps");
  const updateSkill = useUpdateResource("skills");
  const exportRunner = useExportRunnerConfig();
  const toast = useToast();
  const intl = intlLocale(locale);

  const [tab, setTab] = useState("overview");
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [dailyLimitUsd, setDailyLimitUsd] = useState(String(agent.dailyLimitUsd));
  const [wallet, setWallet] = useState(agent.walletAddress ?? "");
  const [transfer, setTransfer] = useState<{ kind: VaultTransferKind; treasury: string } | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    setName(agent.name);
    setRole(agent.role);
    setDailyLimitUsd(String(agent.dailyLimitUsd));
    setWallet(agent.walletAddress ?? agent.signingKey ?? "");
    setTab("overview");
  }, [open, agent]);

  const walletInvalid = isMalformedAddress(wallet);
  const limit = Number(dailyLimitUsd);
  const limitInvalid = !Number.isFinite(limit) || limit < 0;
  const spent = agent.spentUsd ?? 0;
  const remaining = Math.max(agent.dailyLimitUsd - spent, 0);
  const paying = isPayingAgent(agent);
  const sessionKey = agent.signingKey;

  const vault = workflow.treasuryAddress
    ? vaults.vaultByTreasury.get(workflow.treasuryAddress)
    : undefined;
  const isOwner = Boolean(walletAddress) && vault?.owner === walletAddress;

  const scopedMcps = useMemo(
    () => (state.data?.mcps ?? []).filter((mcp) => appliesToAgent(mcp, agent, workflow)),
    [state.data?.mcps, agent, workflow],
  );
  const scopedSkills = useMemo(
    () => (state.data?.skills ?? []).filter((skill) => appliesToAgent(skill, agent, workflow)),
    [state.data?.skills, agent, workflow],
  );

  const statusVariant =
    agent.status === "active" ? "success" : agent.status === "paused" ? "warning" : "secondary";
  const statusLabel =
    agent.status === "active"
      ? t("common.active")
      : agent.status === "paused"
        ? t("common.paused")
        : agent.status;

  const saveGeneral = async () => {
    if (!name.trim() || walletInvalid || limitInvalid) return;
    try {
      await updateAgent.mutateAsync({
        id: agent.id,
        name: name.trim(),
        role: role.trim(),
        dailyLimitUsd: limit,
        walletAddress: wallet.trim() || null,
      });
      toast(t("workflowDialogs.editAgent.updated", { name: name.trim() }));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToUpdate"), "error");
    }
  };

  const toggleStatus = async () => {
    const next = agent.status === "active" ? "paused" : "active";
    try {
      await updateAgent.mutateAsync({ id: agent.id, status: next });
      toast(
        t("agents.statusChanged", {
          name: agent.name,
          status: next === "active" ? t("common.active") : t("common.paused"),
        }),
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToUpdate"), "error");
    }
  };

  const handleRemove = async () => {
    if (!window.confirm(t("agents.confirmRemove", { name: agent.name }))) return;
    try {
      await removeAgent.mutateAsync(agent.id);
      toast(t("agents.removed", { name: agent.name }));
      onOpenChange(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToRemove"), "error");
    }
  };

  const toggleMcp = async (id: string, enabled: boolean) => {
    try {
      await updateMcp.mutateAsync({ id, enabled });
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToUpdate"), "error");
    }
  };

  const toggleSkill = async (id: string, enabled: boolean) => {
    try {
      await updateSkill.mutateAsync({ id, enabled });
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToUpdate"), "error");
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="p-0 sm:max-w-2xl">
          <SheetHeader>
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                <Settings2 className="h-5 w-5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <SheetTitle className="truncate">{agent.name}</SheetTitle>
                  <Badge variant={statusVariant} className="text-[10px]">
                    {statusLabel}
                  </Badge>
                  {agent.demo && <DemoBadge />}
                </div>
                <SheetDescription className="truncate">
                  {agent.role || t("agentSettings.noRole")} · {workflow.icon} {workflow.name}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <SheetBody>
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="mb-4 h-auto w-full flex-wrap justify-start gap-1">
                <TabsTrigger value="overview">{t("agentSettings.tabs.overview")}</TabsTrigger>
                <TabsTrigger value="general">{t("agentSettings.tabs.general")}</TabsTrigger>
                <TabsTrigger value="limits">{t("agentSettings.tabs.limits")}</TabsTrigger>
                <TabsTrigger value="treasury">{t("agentSettings.tabs.treasury")}</TabsTrigger>
                <TabsTrigger value="mcps">{t("agentSettings.tabs.mcps")}</TabsTrigger>
                <TabsTrigger value="skills">{t("agentSettings.tabs.skills")}</TabsTrigger>
              </TabsList>

              <TabsContent value="overview" className="space-y-4">
                <section className="rounded-xl border border-border bg-elevated/30 p-4">
                  <h3 className="mb-3 text-sm font-medium">
                    {t("agentSettings.overview.summary")}
                  </h3>
                  <dl className="space-y-2 text-sm">
                    <Row label={t("common.balance")}>
                      <span className={cn("num font-medium", moneyTone(agent.balance))}>
                        {formatMoney(agent.balance, hidden)}
                      </span>
                    </Row>
                    {agent.dailyLimitUsd > 0 && (
                      <Row label={t("common.todayLimit")}>
                        <span className="num">
                          {t("common.remaining", { amount: formatUsd(remaining, intl, hidden) })}
                        </span>
                      </Row>
                    )}
                    {paying && sessionKey && (
                      <Row label={t("agentWallet.sessionKeyLabel")}>
                        <span className="num" title={sessionKey}>
                          {truncateAddress(sessionKey, 8)}
                        </span>
                      </Row>
                    )}
                    {agent.resolvedSessionAddress && (
                      <Row label={t("agentSettings.overview.session")}>
                        <span className="num" title={agent.resolvedSessionAddress}>
                          {truncateAddress(agent.resolvedSessionAddress, 8)}
                        </span>
                      </Row>
                    )}
                    {agent.paysTo.length > 0 && (
                      <Row label={t("common.paysTo")}>
                        <span>{agent.paysTo.join(", ")}</span>
                      </Row>
                    )}
                    <Row label={t("common.workflow")}>
                      <span>
                        {workflow.icon} {workflow.name}
                      </span>
                    </Row>
                  </dl>
                </section>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={toggleStatus}
                    disabled={updateAgent.isPending}
                  >
                    {agent.status === "active" ? (
                      <Pause className="h-3.5 w-3.5" />
                    ) : (
                      <Play className="h-3.5 w-3.5" />
                    )}
                    {agent.status === "active" ? t("common.pause") : t("common.activate")}
                  </Button>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/agents">{t("agentSettings.overview.allAgents")}</Link>
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={handleRemove}
                    disabled={removeAgent.isPending}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("agentSettings.overview.remove")}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="general" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("agentSettings.general.description")}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="settings-name">{t("common.name")}</Label>
                    <Input
                      id="settings-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-role">
                      {t("workflowDialogs.createAgent.roleLabel")}
                    </Label>
                    <Input
                      id="settings-role"
                      value={role}
                      onChange={(e) => setRole(e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>{t("common.workflow")}</Label>
                  <p className="rounded-lg border border-border bg-elevated/40 px-3 py-2 text-sm text-muted-foreground">
                    {workflow.icon} {workflow.name}
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="settings-limit">
                      {t("workflowDialogs.createAgent.dailyLimitLabel")}
                    </Label>
                    <Input
                      id="settings-limit"
                      type="number"
                      min={0}
                      value={dailyLimitUsd}
                      onChange={(e) => setDailyLimitUsd(e.target.value)}
                      aria-invalid={limitInvalid}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="settings-wallet">
                      {paying
                        ? t("agentWallet.sessionKeyLabel")
                        : t("workflowDialogs.createAgent.walletLabel")}
                    </Label>
                    <Input
                      id="settings-wallet"
                      value={wallet}
                      onChange={(e) => setWallet(e.target.value)}
                      className="num text-sm"
                      aria-invalid={walletInvalid}
                      placeholder={t("workflowDialogs.createAgent.walletPlaceholder")}
                    />
                    {agent.signingKeyFromChain && wallet === agent.signingKey && (
                      <p className="text-xs text-muted-foreground">{t("agentWallet.fromChain")}</p>
                    )}
                    {walletInvalid && (
                      <p className="text-xs text-destructive">{t("common.invalidAddress")}</p>
                    )}
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    onClick={saveGeneral}
                    disabled={
                      !name.trim() || walletInvalid || limitInvalid || updateAgent.isPending
                    }
                  >
                    {updateAgent.isPending ? t("common.saving") : t("common.save")}
                  </Button>
                </div>
              </TabsContent>

              <TabsContent value="limits" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("agentSettings.limits.description")}
                </p>
                {agent.dailyLimitUsd > 0 ? (
                  <CeilingMeter
                    label={agent.name}
                    policy={agent.dailyLimitUsd}
                    spent={spent}
                    format={(v) => formatUsd(v, intl, hidden)}
                    note={t("limits.dashboardLimitOnly")}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t("agentSettings.limits.noDashboardLimit")}
                  </p>
                )}
                <Button variant="outline" size="sm" asChild>
                  <Link href="/limits">
                    <Gauge className="h-3.5 w-3.5" />
                    {t("agentSettings.limits.openLimitsPage")}
                  </Link>
                </Button>
              </TabsContent>

              <TabsContent value="treasury" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {t("agentSettings.treasury.description")}
                </p>
                <section className="rounded-xl border border-border bg-elevated/30 p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <Wallet className="h-4 w-4 text-muted-foreground" />
                    <h3 className="text-sm font-medium">{workflow.name}</h3>
                  </div>
                  <p className={cn("num mb-1 text-2xl font-bold", moneyTone(workflow.balance))}>
                    {formatMoney(workflow.balance, hidden)}
                  </p>
                  {workflow.assets
                    .filter((asset) => asset.mint !== workflow.primaryMint)
                    .map((asset) => (
                      <p key={asset.mint} className="num mb-1 text-xs text-faint-foreground">
                        {formatMoney(asset.money, hidden)}
                      </p>
                    ))}
                  {workflow.treasuryAddress ? (
                    <p className="num text-xs text-muted-foreground">
                      {truncateAddress(workflow.treasuryAddress, 8)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t("treasury.noTreasuryConnected")}
                    </p>
                  )}
                </section>

                {workflow.treasuryAddress ? (
                  <>
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
                      <Button variant="outline" size="sm" asChild>
                        <Link href="/treasury">{t("agentSettings.treasury.openTreasury")}</Link>
                      </Button>
                      <Button variant="ghost" size="icon" asChild>
                        <a
                          href={explorerUrl(workflow.treasuryAddress, cluster)}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={t("treasury.aria.openInExplorer")}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/workflows">{t("agentSettings.treasury.connectVault")}</Link>
                  </Button>
                )}
              </TabsContent>

              <TabsContent value="mcps" className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {t("agentSettings.mcps.description")}
                  </p>
                  <div className="flex shrink-0 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportRunner.isPending}
                      onClick={async () => {
                        try {
                          const { servers, skipped } = await exportRunner.mutateAsync({
                            workflow: { id: workflow.id, name: workflow.name },
                            agent: { id: agent.id, name: agent.name },
                          });
                          if (servers === 0) {
                            toast(t("agentSettings.exportRunnerNothing"), "error");
                            return;
                          }
                          const skippedNote =
                            skipped > 0
                              ? ` ${t("workflowRow.exportedSkipped", { count: skipped })}`
                              : "";
                          toast(
                            t("agentSettings.exportRunnerDone", {
                              count: servers,
                              file: runnerConfigFilename(workflow.name, agent.name),
                            }) + skippedNote,
                          );
                        } catch (error) {
                          toast(
                            error instanceof Error ? error.message : t("common.failedToExport"),
                            "error",
                          );
                        }
                      }}
                    >
                      <Download className="h-3.5 w-3.5" />
                      {t("agentSettings.exportRunner")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportRunner.isPending}
                      onClick={async () => {
                        try {
                          const { servers, skills } = await exportRunner.mutateAsync({
                            workflow: { id: workflow.id, name: workflow.name },
                            agent: { id: agent.id, name: agent.name },
                            format: "zip",
                          });
                          toast(
                            t("agentSettings.exportBundleDone", {
                              servers,
                              skills,
                              file: runnerBundleFilename(workflow.name, agent.name),
                            }),
                          );
                        } catch (error) {
                          toast(
                            error instanceof Error ? error.message : t("common.failedToExport"),
                            "error",
                          );
                        }
                      }}
                    >
                      <Package className="h-3.5 w-3.5" />
                      {t("agentSettings.exportBundle")}
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link href="/mcps">
                        <Cable className="h-3.5 w-3.5" />
                        {t("agentSettings.manage")}
                      </Link>
                    </Button>
                  </div>
                </div>
                {state.isLoading ? (
                  <LoaderRow label={t("common.loading")} />
                ) : scopedMcps.length === 0 ? (
                  <EmptyScopeNote message={t("agentSettings.mcps.empty")} />
                ) : (
                  <ul className="space-y-2">
                    {scopedMcps.map((mcp) => (
                      <li
                        key={mcp.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{mcp.name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {scopeBadgeLabel(mcp, t)}
                            {mcp.command ? "" : ` · ${t("agentSettings.notRunnable")}`}
                          </p>
                        </div>
                        <Switch
                          checked={mcp.enabled}
                          disabled={updateMcp.isPending}
                          onCheckedChange={(checked) => toggleMcp(mcp.id, checked)}
                          aria-label={t("agentSettings.toggleItem", { name: mcp.name })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>

              <TabsContent value="skills" className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-muted-foreground">
                    {t("agentSettings.skills.description")}
                  </p>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/skills">
                      <Brain className="h-3.5 w-3.5" />
                      {t("agentSettings.manage")}
                    </Link>
                  </Button>
                </div>
                {state.isLoading ? (
                  <LoaderRow label={t("common.loading")} />
                ) : scopedSkills.length === 0 ? (
                  <EmptyScopeNote message={t("agentSettings.skills.empty")} />
                ) : (
                  <ul className="space-y-2">
                    {scopedSkills.map((skill) => (
                      <li
                        key={skill.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {skill.icon} {skill.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {scopeBadgeLabel(skill, t)}
                          </p>
                        </div>
                        <Switch
                          checked={skill.enabled}
                          disabled={updateSkill.isPending}
                          onCheckedChange={(checked) => toggleSkill(skill.id, checked)}
                          aria-label={t("agentSettings.toggleItem", { name: skill.name })}
                        />
                      </li>
                    ))}
                  </ul>
                )}
              </TabsContent>
            </Tabs>
          </SheetBody>
        </SheetContent>
      </Sheet>

      <VaultTransferDialog
        kind={transfer?.kind ?? null}
        treasury={transfer?.treasury ?? null}
        assets={workflow.assets}
        defaultMint={workflow.primaryMint}
        ownerTokenByMint={vaults.ownerTokenByMint}
        walletLamports={walletAddress ? (balances.byAddress.get(walletAddress) ?? null) : null}
        rentExemptMinimum={vaults.rentExemptMinimum}
        onClose={() => setTransfer(null)}
      />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate text-right">{children}</dd>
    </div>
  );
}

function LoaderRow({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </div>
  );
}

function EmptyScopeNote({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
      {message}
    </p>
  );
}
