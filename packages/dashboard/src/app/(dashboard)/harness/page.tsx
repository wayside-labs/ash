"use client";

import { Loader2, Play, Square, Terminal, Wrench } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useUpdateResource, useWorkflows } from "@/hooks/use-dashboard";
import type { Agent } from "@/lib/types";

export default function HarnessPage() {
  const { workflows, isLoading } = useWorkflows();
  const update = useUpdateResource("agents");
  const toast = useToast();
  const [logsFor, setLogsFor] = useState<Agent | null>(null);

  const agents = workflows.flatMap((w) => w.agents.map((a) => ({ agent: a, workflow: w })));

  const toggle = async (agent: Agent) => {
    const next = agent.status === "active" ? "paused" : "active";
    try {
      await update.mutateAsync({ id: agent.id, status: next });
      toast(`${agent.name} marcado como ${next === "active" ? "rodando" : "parado"}.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao atualizar", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="Harness"
        description="Onde cada agente roda. O dashboard registra o estado; não há runtime Docker conectado ainda."
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={Wrench}
          title="Nenhum agente"
          description="Crie agentes para acompanhar seus ambientes de execução."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {agents.map(({ agent, workflow }) => {
            const running = agent.status === "active";
            return (
              <Card key={agent.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="truncate text-base">
                      {agent.name} — {workflow.name}
                    </CardTitle>
                    <Badge variant={running ? "success" : "secondary"}>
                      {running ? "rodando" : "parado"}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">
                    Runtime: {agent.sessionAddress ? "sessão on-chain" : "não provisionado"}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggle(agent)}
                      disabled={update.isPending}
                    >
                      {running ? (
                        <>
                          <Square className="h-3.5 w-3.5" />
                          Parar
                        </>
                      ) : (
                        <>
                          <Play className="h-3.5 w-3.5" />
                          Iniciar
                        </>
                      )}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setLogsFor(agent)}>
                      <Terminal className="h-3.5 w-3.5" />
                      Logs
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={logsFor !== null} onOpenChange={(open) => !open && setLogsFor(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Logs — {logsFor?.name}</DialogTitle>
            <DialogDescription>
              Sem runtime conectado, não há logs para exibir. Rode o agente pelo servidor MCP e
              acompanhe a saída no terminal:
            </DialogDescription>
          </DialogHeader>
          <code className="block rounded-lg bg-muted p-3 text-xs">
            pnpm --filter @agent-rails/mcp start
          </code>
          <p className="text-xs text-muted-foreground">
            Um runtime Docker com start/stop e streaming de logs é trabalho de fase 3 no handoff.
          </p>
        </DialogContent>
      </Dialog>
    </div>
  );
}
