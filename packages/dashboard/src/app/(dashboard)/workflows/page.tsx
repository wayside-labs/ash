import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { WorkflowRow } from "@/components/workflows/workflow-row";
import { mockWorkflows } from "@/lib/mock-data";

export default function WorkflowsPage() {
  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Empresas, projetos e operações com seus agentes"
        action={
          <Button>
            <Plus className="h-4 w-4" />
            Novo Workflow
          </Button>
        }
      />
      {mockWorkflows.map((workflow) => (
        <WorkflowRow key={workflow.id} workflow={workflow} />
      ))}
    </div>
  );
}
