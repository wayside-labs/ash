"use client";

import { Eye, EyeOff, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useCreateResource, useDashboardState, useDeleteResource } from "@/hooks/use-dashboard";

const PROVIDERS = ["Anthropic", "OpenAI", "Helius", "Outro"];

export default function ApisPage() {
  const { data, isLoading } = useDashboardState();
  const create = useCreateResource("apiKeys");
  const remove = useDeleteResource("apiKeys");
  const toast = useToast();
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [secret, setSecret] = useState("");

  const keys = data?.apiKeys ?? [];

  const submit = async () => {
    if (!secret.trim()) return;
    try {
      await create.mutateAsync({ provider, secret: secret.trim() });
      toast(`Chave ${provider} salva no servidor.`);
      setSecret("");
      setOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao salvar", "error");
    }
  };

  return (
    <div>
      <PageHeader
        title="My APIs"
        description="Chaves de API dos provedores de IA"
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Adicionar provedor
          </Button>
        }
      />

      <Card className="mb-6 border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-medium">As chaves ficam no servidor</p>
            <p className="text-muted-foreground">
              O valor completo nunca é enviado de volta ao navegador — a API só devolve uma máscara.
              Uma chave Anthropic aqui liga o chat aos seus dados reais.
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="Nenhuma chave configurada"
          description="Sem chave, o chat responde em modo demonstração."
          action={{ label: "Adicionar chave", onClick: () => setOpen(true) }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {keys.map((api) => (
            <Card key={api.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>{api.provider}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={api.status === "connected" ? "success" : "secondary"}>
                      {api.status === "connected" ? "conectado" : "vazio"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remover chave ${api.provider}`}
                      onClick={() => remove.mutate(api.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Label className="mb-2 block text-xs text-muted-foreground">KEY</Label>
                <div className="flex gap-2">
                  <Input
                    type={visible[api.id] ? "text" : "password"}
                    value={api.keyMasked}
                    readOnly
                    className="num text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={visible[api.id] ? "Ocultar" : "Mostrar"}
                    onClick={() => setVisible((v) => ({ ...v, [api.id]: !v[api.id] }))}
                  >
                    {visible[api.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Mesmo revelado, isto é a máscara — o valor real não sai do servidor.
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar chave de API</DialogTitle>
            <DialogDescription>
              A chave é gravada em ~/.agent-rails/dashboard.json com permissão 600 e nunca volta
              inteira para o navegador.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Provedor</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-secret">Chave</Label>
              <Input
                id="api-secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="sk-ant-…"
                className="num"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submit} disabled={!secret.trim() || create.isPending}>
              Salvar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
