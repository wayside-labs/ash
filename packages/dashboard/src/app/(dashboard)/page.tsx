"use client";

import { Loader2, Plus, Zap } from "lucide-react";
import { useState } from "react";
import { ChatPanel } from "@/components/chat/chat-panel";
import { EmptyState } from "@/components/shared/empty-state";
import { Button } from "@/components/ui/button";
import { CreateAgentDialog, CreateWorkflowDialog } from "@/components/workflows/workflow-dialogs";
import { WorkflowRow } from "@/components/workflows/workflow-row";
import { useWorkflows } from "@/hooks/use-dashboard";

export default function HomePage() {
  const { workflows, isLoading } = useWorkflows();
  const [workflowDialog, setWorkflowDialog] = useState(false);
  const [agentDialog, setAgentDialog] = useState<string | null>(null);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-6 lg:flex-row">
      <div className="flex-1 lg:max-w-md">
        <ChatPanel className="h-full min-h-[400px]" />
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Seus Workflows</h2>
          <Button size="sm" onClick={() => setWorkflowDialog(true)}>
            <Plus className="h-3.5 w-3.5" />
            Novo
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando…
          </div>
        ) : workflows.length === 0 ? (
          <EmptyState
            icon={Zap}
            title="Nenhum workflow ainda"
            description="Crie o primeiro workflow para agrupar agentes em torno de um cofre."
            action={{ label: "Criar workflow", onClick: () => setWorkflowDialog(true) }}
          />
        ) : (
          workflows.map((workflow) => (
            <WorkflowRow key={workflow.id} workflow={workflow} onAddAgent={setAgentDialog} />
          ))
        )}
      </div>

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
