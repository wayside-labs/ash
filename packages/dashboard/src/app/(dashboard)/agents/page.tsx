"use client";

import { Bot, Loader2, Plus, Settings2, Trash2 } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AgentCard } from "@/components/workflows/agent-card";
import { AgentSettingsSheet } from "@/components/workflows/agent-settings-sheet";
import { CreateAgentDialog } from "@/components/workflows/workflow-dialogs";
import { useDeleteResource, useUpdateResource, useWorkflows } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import type { Agent, Workflow } from "@/lib/types";

export default function AgentsPage() {
  const { t } = useTranslation();
  const { workflows, isLoading } = useWorkflows({ withChain: false });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settings, setSettings] = useState<{ agent: Agent; workflow: Workflow } | null>(null);
  const update = useUpdateResource("agents");
  const remove = useDeleteResource("agents");
  const toast = useToast();

  const toggleStatus = async (agent: Agent) => {
    const next = agent.status === "active" ? "paused" : "active";
    try {
      await update.mutateAsync({ id: agent.id, status: next });
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

  const removeAgent = async (agent: Agent) => {
    if (!window.confirm(t("agents.confirmRemove", { name: agent.name }))) return;
    try {
      await remove.mutateAsync(agent.id);
      toast(t("agents.removed", { name: agent.name }));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToRemove"), "error");
    }
  };

  const hasAgents = workflows.some((w) => w.agents.length > 0);

  return (
    <div>
      <PageHeader
        wallet
        title={t("agents.title")}
        description={t("agents.description")}
        action={
          <Button onClick={() => setDialogOpen(true)} disabled={workflows.length === 0}>
            <Plus className="h-4 w-4" />
            {t("agents.newAgent")}
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : !hasAgents ? (
        <EmptyState
          icon={Bot}
          title={t("agents.emptyTitle")}
          description={t("agents.emptyDescription")}
          {...(workflows.length > 0
            ? { action: { label: t("agents.createAgent"), onClick: () => setDialogOpen(true) } }
            : {})}
        />
      ) : (
        workflows
          .filter((workflow) => workflow.agents.length > 0)
          .map((workflow) => (
            <section key={workflow.id} className="mb-8">
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
                <span>{workflow.icon}</span>
                {workflow.name}
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {workflow.agents.map((agent) => (
                  // The id is the handle the UI suite grabs a card by; a name
                  // match would find the heading and the settings sheet too.
                  <div key={agent.id} data-testid={`agent-${agent.id}`} className="space-y-2">
                    <AgentCard
                      agent={agent}
                      className="w-full"
                      onClick={() => setSettings({ agent, workflow })}
                    />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => toggleStatus(agent)}
                        disabled={update.isPending}
                      >
                        {agent.status === "active" ? t("common.pause") : t("common.activate")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("agentSettings.open", { name: agent.name })}
                        onClick={() => setSettings({ agent, workflow })}
                      >
                        <Settings2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={t("agents.aria.removeAgent", { name: agent.name })}
                        onClick={() => removeAgent(agent)}
                        disabled={remove.isPending}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
      )}

      <p className="mt-6 text-xs text-muted-foreground">{t("agents.footerNote")}</p>

      <CreateAgentDialog open={dialogOpen} onOpenChange={setDialogOpen} workflows={workflows} />
      {settings && (
        <AgentSettingsSheet
          key={settings.agent.id}
          agent={settings.agent}
          workflow={settings.workflow}
          open
          onOpenChange={(open) => !open && setSettings(null)}
        />
      )}
    </div>
  );
}
