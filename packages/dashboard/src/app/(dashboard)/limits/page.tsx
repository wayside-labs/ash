import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockWorkflows } from "@/lib/mock-data";
import { formatUsd } from "@/lib/utils";

function LimitBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  const color = pct > 80 ? "bg-destructive" : pct > 50 ? "bg-warning" : "bg-primary";

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-muted-foreground">
          {formatUsd(used)} / {formatUsd(total)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function LimitsPage() {
  return (
    <div>
      <PageHeader title="Limits" description="Limites de gasto por workflow e agente" />
      <div className="space-y-6">
        {mockWorkflows.map((workflow) => {
          const totalDaily = workflow.agents.reduce((s, a) => s + a.dailyLimitUsd, 0);
          const totalSpent = workflow.agents.reduce((s, a) => s + a.dailySpentUsd, 0);

          return (
            <Card key={workflow.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>{workflow.icon}</span>
                  {workflow.name}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <LimitBar label="Limite diário total" used={totalSpent} total={totalDaily} />
                <div className="space-y-3 border-t border-border pt-4">
                  {workflow.agents.map((agent) => (
                    <LimitBar
                      key={agent.id}
                      label={`${agent.name} (${agent.role})`}
                      used={agent.dailySpentUsd}
                      total={agent.dailyLimitUsd}
                    />
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
