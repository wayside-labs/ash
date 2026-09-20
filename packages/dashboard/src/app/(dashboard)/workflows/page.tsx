"use client";

import { Loader2, Plus, Zap } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { CreateAgentDialog, CreateWorkflowDialog } from "@/components/workflows/workflow-dialogs";
import { WorkflowRow } from "@/components/workflows/workflow-row";
import { useWorkflows } from "@/hooks/use-dashboard";

export default function WorkflowsPage() {
  const { workflows, isLoading } = useWorkflows();
  const [workflowDialog, setWorkflowDialog] = useState(false);
  const [agentDialog, setAgentDialog] = useState<string | null>(null);

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Empresas, projetos e operações com seus agentes"
        action={
          <Button onClick={() => setWorkflowDialog(true)}>
            <Plus className="h-4 w-4" />
            Novo Workflow
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : workflows.length === 0 ? (
        <EmptyState
          icon={Zap}
          title="Nenhum workflow"
          description="Um workflow agrupa agentes em torno de um cofre."
          action={{ label: "Criar workflow", onClick: () => setWorkflowDialog(true) }}
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
