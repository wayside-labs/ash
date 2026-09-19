import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { mockMcps } from "@/lib/mock-data";

export default function McpsPage() {
  return (
    <div>
      <PageHeader
        title="MCPs"
        description="Ferramentas que seus agentes podem usar"
        action={
          <Button>
            <Plus className="h-4 w-4" />
            Adicionar MCP
          </Button>
        }
      />
      <div className="grid gap-3">
        {mockMcps.map((mcp) => (
          <Card key={mcp.id}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{mcp.name}</span>
                  <Badge variant="outline">{mcp.scope}</Badge>
                  {mcp.scopeName && (
                    <span className="text-xs text-muted-foreground">{mcp.scopeName}</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{mcp.description}</p>
              </div>
              <Switch checked={mcp.enabled} />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
