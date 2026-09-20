"use client";

import { Brain, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toast";
import {
  useCreateResource,
  useDashboardState,
  useDeleteResource,
  useUpdateResource,
} from "@/hooks/use-dashboard";
import type { Skill } from "@/lib/types";

export default function SkillsPage() {
  const { data, isLoading } = useDashboardState();
  const update = useUpdateResource("skills");
  const remove = useDeleteResource("skills");
  const create = useCreateResource("skills");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("🧩");
  const [scope, setScope] = useState<"global" | "workflow" | "agent">("global");

  const skills = data?.skills ?? [];

  const toggle = async (skill: Skill, enabled: boolean) => {
    try {
      await update.mutateAsync({ id: skill.id, enabled });
      toast(`${skill.name} ${enabled ? "ativada" : "desativada"}.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao salvar", "error");
    }
  };

  const submit = async () => {
    if (!name.trim()) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        icon,
        scope,
        enabled: true,
        demo: false,
      });
      toast(`Skill "${name.trim()}" criada.`);
      setName("");
      setDescription("");
      setOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao criar", "error");
    }
  };

  const SkillList = ({ items }: { items: Skill[] }) =>
    items.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma skill neste escopo.</p>
    ) : (
      <div className="grid gap-3">
        {items.map((skill) => (
          <Card key={skill.id}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-xl">{skill.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{skill.name}</p>
                    {skill.demo && <DemoBadge />}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{skill.description}</p>
                  {skill.scopeName && (
                    <Badge variant="outline" className="mt-1">
                      {skill.scopeName}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={(checked) => toggle(skill, checked)}
                  aria-label={`Ativar ${skill.name}`}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover ${skill.name}`}
                  onClick={() => remove.mutate(skill.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
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
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Nova Skill
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : skills.length === 0 ? (
        <EmptyState
          icon={Brain}
          title="Nenhuma skill"
          description="Skills definem o que cada agente sabe fazer."
          action={{ label: "Criar skill", onClick: () => setOpen(true) }}
        />
      ) : (
        <Tabs defaultValue="global">
          <TabsList>
            <TabsTrigger value="global">Globais</TabsTrigger>
            <TabsTrigger value="workflow">Por Workflow</TabsTrigger>
            <TabsTrigger value="agent">Por Agente</TabsTrigger>
          </TabsList>
          <TabsContent value="global">
            <SkillList items={skills.filter((s) => s.scope === "global")} />
          </TabsContent>
          <TabsContent value="workflow">
            <SkillList items={skills.filter((s) => s.scope === "workflow")} />
          </TabsContent>
          <TabsContent value="agent">
            <SkillList items={skills.filter((s) => s.scope === "agent")} />
          </TabsContent>
        </Tabs>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova skill</DialogTitle>
            <DialogDescription>Uma capacidade que o agente pode usar.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
              <div className="space-y-2">
                <Label htmlFor="sk-icon">Ícone</Label>
                <Input
                  id="sk-icon"
                  value={icon}
                  onChange={(e) => setIcon(e.target.value)}
                  className="w-16 text-center"
                  maxLength={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sk-name">Nome</Label>
                <Input id="sk-name" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sk-desc">Descrição</Label>
              <Input
                id="sk-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Escopo</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as typeof scope)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="workflow">Por workflow</SelectItem>
                  <SelectItem value="agent">Por agente</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={!name.trim() || create.isPending}>
              Criar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
