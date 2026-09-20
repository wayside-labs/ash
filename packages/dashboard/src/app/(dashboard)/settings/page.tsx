"use client";

import { AlertTriangle, CheckCircle2, Download, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  useDashboardState,
  useResetState,
  useRpcHealth,
  useUpdateSettings,
} from "@/hooks/use-dashboard";
import { CLUSTER_LABELS } from "@/lib/solana";
import type { SolanaCluster } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

export default function SettingsPage() {
  const { cluster, customRpc, setCluster, setCustomRpc } = useAppStore();
  const { data, isLoading } = useDashboardState();
  const saveSettings = useUpdateSettings();
  const reset = useResetState();
  const health = useRpcHealth();
  const toast = useToast();

  const [rpcInput, setRpcInput] = useState(customRpc);
  useEffect(() => setRpcInput(customRpc), [customRpc]);

  const settings = data?.settings;

  const patch = async (partial: Record<string, unknown>) => {
    if (!settings) return;
    try {
      await saveSettings.mutateAsync({ ...settings, ...partial });
      toast("Preferência salva.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao salvar", "error");
    }
  };

  const testRpc = async () => {
    const result = await health.mutateAsync({ cluster, rpc: rpcInput.trim() || null });
    toast(
      result.ok ? `RPC respondendo — ${result.detail}` : `Falhou: ${result.detail}`,
      result.ok ? "success" : "error",
    );
  };

  const exportConfig = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "agent-rails-dashboard.json";
    a.click();
    URL.revokeObjectURL(url);
    toast("Configuração exportada (sem as chaves de API).");
  };

  const restoreDefaults = async () => {
    if (
      !window.confirm(
        "Isto apaga workflows, agentes e chaves salvas e restaura os dados de demonstração. Continuar?",
      )
    ) {
      return;
    }
    try {
      await reset.mutateAsync();
      toast("Dados restaurados ao padrão.");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao restaurar", "error");
    }
  };

  return (
    <div>
      <PageHeader title="Settings" description="Preferências do sistema" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Rede Solana</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Cluster padrão</Label>
              <Select value={cluster} onValueChange={(v) => setCluster(v as SolanaCluster)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CLUSTER_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="rpc">RPC customizado (Helius, etc.)</Label>
              <Input
                id="rpc"
                placeholder="https://devnet.helius-rpc.com/?api-key=…"
                value={rpcInput}
                onChange={(e) => setRpcInput(e.target.value)}
                onBlur={() => setCustomRpc(rpcInput)}
              />
              <p className="text-xs text-muted-foreground">
                Só https e host público — endereços de rede interna são ignorados e o cluster padrão
                assume.
              </p>
              <Button variant="outline" size="sm" onClick={testRpc} disabled={health.isPending}>
                {health.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                Testar conexão
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Preferências</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading || !settings ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando…
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>Idioma</Label>
                  <Select value={settings.language} onValueChange={(v) => patch({ language: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pt-BR">Português (BR)</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    A preferência é salva; a tradução da interface ainda não foi feita.
                  </p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>Alertas de limite</Label>
                    <p className="text-xs text-muted-foreground">
                      Destaca agentes acima de 80% do limite diário.
                    </p>
                  </div>
                  <Switch
                    checked={settings.limitAlerts}
                    onCheckedChange={(checked) => patch({ limitAlerts: checked })}
                    aria-label="Alertas de limite"
                  />
                </div>

                <div className="flex items-center justify-between opacity-60">
                  <div>
                    <Label>Notificações por email</Label>
                    <p className="text-xs text-muted-foreground">
                      Precisa de um provedor de email — ainda não conectado.
                    </p>
                  </div>
                  <Switch checked={false} disabled aria-label="Notificações por email" />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Dados</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Tudo que você cria aqui fica em{" "}
              <code className="text-foreground">~/.agent-rails/dashboard.json</code>.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={exportConfig} disabled={!data}>
                <Download className="h-4 w-4" />
                Exportar configuração
              </Button>
              <Button variant="destructive" onClick={restoreDefaults} disabled={reset.isPending}>
                <RotateCcw className="h-4 w-4" />
                Restaurar padrões
              </Button>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              Restaurar apaga workflows, agentes e chaves salvas. Não toca em nada on-chain — cofres
              e sessões continuam existindo na rede.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
