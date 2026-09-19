import { Play, Square, Terminal } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { mockWorkflows } from "@/lib/mock-data";

const harnesses = mockWorkflows.flatMap((w) =>
  w.agents.map((a) => ({
    id: `h-${a.id}`,
    name: `${a.name} — ${w.name}`,
    runtime: a.id === "a5" ? "Docker local" : "Cloud",
    status: a.status === "active" ? "running" : "stopped",
  })),
);

export default function HarnessPage() {
  return (
    <div>
      <PageHeader title="Harness" description="Ambientes de execução dos agentes" />
      <div className="grid gap-4 md:grid-cols-2">
        {harnesses.slice(0, 6).map((h) => (
          <Card key={h.id}>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{h.name}</CardTitle>
                <Badge variant={h.status === "running" ? "success" : "secondary"}>{h.status}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Runtime: {h.runtime}</p>
              <div className="flex gap-2">
                {h.status === "running" ? (
                  <Button variant="outline" size="sm">
                    <Square className="h-3.5 w-3.5" />
                    Parar
                  </Button>
                ) : (
                  <Button variant="outline" size="sm">
                    <Play className="h-3.5 w-3.5" />
                    Iniciar
                  </Button>
                )}
                <Button variant="ghost" size="sm">
                  <Terminal className="h-3.5 w-3.5" />
                  Logs
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
