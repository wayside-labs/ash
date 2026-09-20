"use client";

import { Cable, Loader2, Plus, Trash2 } from "lucide-react";
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
import { useToast } from "@/components/ui/toast";
import {
  useCreateResource,
  useDashboardState,
  useDeleteResource,
  useUpdateResource,
} from "@/hooks/use-dashboard";

export default function McpsPage() {
  const { data, isLoading } = useDashboardState();
  const update = useUpdateResource("mcps");
  const remove = useDeleteResource("mcps");
  const create = useCreateResource("mcps");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [scope, setScope] = useState<"global" | "workflow" | "agent">("global");

  const toggle = async (id: string, enabled: boolean, label: string) => {
    try {
      await update.mutateAsync({ id, enabled });
      toast(`${label} ${enabled ? "ativado" : "desativado"}.`);
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
        scope,
        enabled: false,
        demo: false,
      });
      toast(`MCP "${name.trim()}" adicionado.`);
      setName("");
      setDescription("");
      setOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao adicionar", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="MCPs"
        description="Ferramentas que seus agentes podem usar. O estado fica salvo no servidor."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Adicionar MCP
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : (data?.mcps.length ?? 0) === 0 ? (
        <EmptyState
          icon={Cable}
          title="Nenhum MCP"
          description="Conecte servidores MCP para dar ferramentas aos seus agentes."
          action={{ label: "Adicionar MCP", onClick: () => setOpen(true) }}
        />
      ) : (
        <div className="grid gap-3">
          {data?.mcps.map((mcp) => (
            <Card key={mcp.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{mcp.name}</span>
                    <Badge variant="outline">{mcp.scope}</Badge>
                    {mcp.scopeName && (
                      <span className="text-xs text-muted-foreground">{mcp.scopeName}</span>
                    )}
                    {mcp.demo && <DemoBadge />}
                  </div>
                  <p className="text-sm text-muted-foreground">{mcp.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={mcp.enabled}
                    onCheckedChange={(checked) => toggle(mcp.id, checked, mcp.name)}
                    aria-label={`Ativar ${mcp.name}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remover ${mcp.name}`}
                    onClick={() => remove.mutate(mcp.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar MCP</DialogTitle>
            <DialogDescription>
              Servidores MCP dão ferramentas ao agente. O servidor do Agent Rails expõe apenas
              pagamento e consulta — nunca saque ou alteração de política.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="mcp-name">Nome</Label>
              <Input id="mcp-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="mcp-desc">Descrição</Label>
              <Input
                id="mcp-desc"
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
              Adicionar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
