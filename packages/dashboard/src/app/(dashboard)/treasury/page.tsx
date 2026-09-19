import { ArrowDownLeft, ArrowUpRight, Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockWorkflows } from "@/lib/mock-data";
import { formatUsd, truncateAddress } from "@/lib/utils";

export default function TreasuryPage() {
  return (
    <div>
      <PageHeader
        title="Treasury"
        description="Cofres e fundos de cada workflow"
        action={
          <Button>
            <Plus className="h-4 w-4" />
            Novo Cofre
          </Button>
        }
      />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {mockWorkflows.map((workflow) => (
          <Card key={workflow.id}>
            <CardHeader>
              <div className="flex items-center gap-2">
                <span className="text-2xl">{workflow.icon}</span>
                <CardTitle>{workflow.name}</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-2xl font-bold text-primary">
                  {formatUsd(workflow.treasuryBalanceUsd)}
                </p>
                <p className="text-xs text-muted-foreground">
                  Vault: {truncateAddress(`vault_${workflow.id}_abc123`, 6)}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1">
                  <ArrowDownLeft className="h-3.5 w-3.5" />
                  Depositar
                </Button>
                <Button variant="outline" size="sm" className="flex-1">
                  <ArrowUpRight className="h-3.5 w-3.5" />
                  Sacar
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {workflow.agents.length} agentes · Política ativa
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
