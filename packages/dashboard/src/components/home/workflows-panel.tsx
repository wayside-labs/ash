"use client";

import { Loader2, Plus, Zap } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { CreateAgentDialog, CreateWorkflowDialog } from "@/components/workflows/workflow-dialogs";
import { WorkflowRow } from "@/components/workflows/workflow-row";
import { useWorkflows } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";

export function WorkflowsPanel() {
  const { t } = useTranslation();
  const { workflows, isLoading } = useWorkflows();
  const [workflowDialog, setWorkflowDialog] = useState(false);
  const [agentDialog, setAgentDialog] = useState<string | null>(null);

  return (
    <>
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-3">
          <h2 className="truncate text-sm font-medium">{t("home.workflowsTitle")}</h2>
          <Button size="sm" variant="outline" onClick={() => setWorkflowDialog(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t("home.newButton")}
          </Button>
        </header>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4">
            {isLoading ? (
              <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : workflows.length === 0 ? (
              <EmptyState
                icon={Zap}
                title={t("home.emptyTitle")}
                description={t("home.emptyDescription")}
                action={{
                  label: t("home.createWorkflow"),
                  onClick: () => setWorkflowDialog(true),
                }}
              />
            ) : (
              workflows.map((workflow) => (
                <WorkflowRow key={workflow.id} workflow={workflow} onAddAgent={setAgentDialog} />
              ))
            )}
          </div>
        </ScrollArea>
      </div>

      <CreateWorkflowDialog open={workflowDialog} onOpenChange={setWorkflowDialog} />
      <CreateAgentDialog
        open={agentDialog !== null}
        onOpenChange={(open) => !open && setAgentDialog(null)}
        workflows={workflows}
        {...(agentDialog ? { defaultWorkflowId: agentDialog } : {})}
      />
    </>
  );
}
