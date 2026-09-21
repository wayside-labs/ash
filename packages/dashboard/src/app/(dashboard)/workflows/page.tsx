"use client";

import { Loader2, Plus, Zap } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { CreateAgentDialog, CreateWorkflowDialog } from "@/components/workflows/workflow-dialogs";
import { WorkflowRow } from "@/components/workflows/workflow-row";
import { useWorkflows } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";

export default function WorkflowsPage() {
  const { t } = useTranslation();
  const { workflows, isLoading } = useWorkflows();
  const [workflowDialog, setWorkflowDialog] = useState(false);
  const [agentDialog, setAgentDialog] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title={t("workflows.title")}
        description={t("workflows.description")}
        action={
          <Button onClick={() => setWorkflowDialog(true)}>
            <Plus className="h-4 w-4" />
            {t("workflows.newWorkflow")}
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={Zap}
          title={t("workflows.emptyTitle")}
          description={t("workflows.emptyDescription")}
          action={{ label: t("workflows.createWorkflow"), onClick: () => setWorkflowDialog(true) }}
        />
      ) : (
        workflows.map((workflow) => (
          <WorkflowRow key={workflow.id} workflow={workflow} onAddAgent={setAgentDialog} />
        ))
      )}

      <CreateWorkflowDialog open={workflowDialog} onOpenChange={setWorkflowDialog} />
      <CreateAgentDialog
        open={agentDialog !== null}
        onOpenChange={(open) => !open && setAgentDialog(null)}
        workflows={workflows}
        {...(agentDialog ? { defaultWorkflowId: agentDialog } : {})}
      />
    </div>
  );
}
