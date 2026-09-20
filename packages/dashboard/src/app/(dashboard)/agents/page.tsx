"use client";

import { Bot, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AgentCard } from "@/components/workflows/agent-card";
import { CreateAgentDialog } from "@/components/workflows/workflow-dialogs";
import { useDeleteResource, useUpdateResource, useWorkflows } from "@/hooks/use-dashboard";
import type { Agent } from "@/lib/types";

export default function AgentsPage() {
  const { workflows, isLoading } = useWorkflows();
  const [dialogOpen, setDialogOpen] = useState(false);
  const update = useUpdateResource("agents");
  const remove = useDeleteResource("agents");
  const toast = useToast();

  const toggleStatus = async (agent: Agent) => {
    const next = agent.status === "active" ? "paused" : "active";
    try {
      await update.mutateAsync({ id: agent.id, status: next });
      toast(`${agent.name} agora está ${next === "active" ? "ativo" : "pausado"}.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao atualizar", "error");
    }
  };

  const removeAgent = async (agent: Agent) => {
    if (!window.confirm(`Remover o agente "${agent.name}"?`)) return;
    try {
      await remove.mutateAsync(agent.id);
      toast(`Agente "${agent.name}" removido.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao remover", "error");
    }
  };

  const hasAgents = workflows.some((w) => w.agents.length > 0);

  return (
    <div>
      <PageHeader
        title="Agents"
        description="Todos os agentes organizados por workflow"
        action={
          <Button onClick={() => setDialogOpen(true)} disabled={workflows.length === 0}>
            <Plus className="h-4 w-4" />
            Novo Agente
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : !hasAgents ? (
        <EmptyState
          icon={Bot}
          title="Nenhum agente"
          description="Crie um workflow primeiro e depois adicione agentes a ele."
          {...(workflows.length > 0
            ? { action: { label: "Criar agente", onClick: () => setDialogOpen(true) } }
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
                  <div key={agent.id} className="space-y-2">
                    <AgentCard agent={agent} className="w-full" />
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
                        onClick={() => toggleStatus(agent)}
                        disabled={update.isPending}
                      >
                        {agent.status === "active" ? "Pausar" : "Ativar"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remover ${agent.name}`}
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

      <p className="mt-6 text-xs text-muted-foreground">
        Pausar aqui muda apenas o rótulo no dashboard. Revogar a sessão on-chain é uma ação de
        operador e exige assinatura — nunca do lado do agente.
      </p>

      <CreateAgentDialog open={dialogOpen} onOpenChange={setDialogOpen} workflows={workflows} />
    </div>
  );
}
