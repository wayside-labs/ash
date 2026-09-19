import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { AgentCard } from "@/components/workflows/agent-card";
import { mockWorkflows } from "@/lib/mock-data";

export default function AgentsPage() {
  return (
    <div>
      <PageHeader
        title="Agents"
        description="Todos os agentes organizados por workflow"
        action={
          <Button>
            <Plus className="h-4 w-4" />
            Novo Agente
          </Button>
        }
      />
      {mockWorkflows.map((workflow) => (
        <section key={workflow.id} className="mb-8">
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
            <span>{workflow.icon}</span>
            {workflow.name}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {workflow.agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} className="w-full" />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
