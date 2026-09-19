import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mockSkills } from "@/lib/mock-data";

export default function SkillsPage() {
  const global = mockSkills.filter((s) => s.scope === "global");
  const workflow = mockSkills.filter((s) => s.scope === "workflow");
  const agent = mockSkills.filter((s) => s.scope === "agent");

  const SkillList = ({ items }: { items: typeof mockSkills }) => (
    <div className="grid gap-3">
      {items.map((skill) => (
        <Card key={skill.id}>
          <CardContent className="flex items-center justify-between gap-4 p-4">
            <div className="flex items-center gap-3">
              <span className="text-xl">{skill.icon}</span>
              <div>
                <p className="font-medium">{skill.name}</p>
                <p className="text-sm text-muted-foreground">{skill.description}</p>
                {skill.scopeName && (
                  <Badge variant="outline" className="mt-1">
                    {skill.scopeName}
                  </Badge>
                )}
              </div>
            </div>
            <Switch checked={skill.enabled} />
          </CardContent>
        </Card>
      ))}
    </div>
  );

  return (
    <div>
      <PageHeader
        title="Skills"
        description="Capacidades dos seus agentes"
        action={
          <Button>
            <Plus className="h-4 w-4" />
            Nova Skill
          </Button>
        }
      />
      <Tabs defaultValue="global">
        <TabsList>
          <TabsTrigger value="global">Globais</TabsTrigger>
          <TabsTrigger value="workflow">Por Workflow</TabsTrigger>
          <TabsTrigger value="agent">Por Agente</TabsTrigger>
        </TabsList>
        <TabsContent value="global">
          <SkillList items={global} />
        </TabsContent>
        <TabsContent value="workflow">
          <SkillList items={workflow} />
        </TabsContent>
        <TabsContent value="agent">
          <SkillList items={agent} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
