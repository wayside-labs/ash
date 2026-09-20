"use client";

import { ExternalLink, Loader2, ShieldCheck, Zap } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useDashboardState, useUpdateResource } from "@/hooks/use-dashboard";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export default function IntegrationsPage() {
  const { operationMode, setOperationMode } = useAppStore();
  const { data, isLoading } = useDashboardState();
  const update = useUpdateResource("integrations");
  const toast = useToast();

  const toggle = async (id: string, connected: boolean, name: string) => {
    try {
      await update.mutateAsync({ id, connected });
      toast(`${name} ${connected ? "conectado" : "desconectado"}.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao salvar", "error");
    }
  };

  return (
    <div>
      <PageHeader title="Integrações" description="Conecte dApps Solana e serviços externos" />

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        <ModeCard
          active={operationMode === "native"}
          onClick={() => setOperationMode("native")}
          icon={<Zap className="h-5 w-5" />}
          title="Solana Nativo"
          description="Sua carteira assina cada transação diretamente. Sem cofre, sem limites — você é o único guardrail."
        />
        <ModeCard
          active={operationMode === "agent-rails"}
          onClick={() => setOperationMode("agent-rails")}
          icon={<ShieldCheck className="h-5 w-5" />}
          title="Agent Rails Vault"
          description="O agente paga a partir de um cofre com teto por transação, por janela e por sessão, com recibo on-chain de cada pagamento."
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : (
        <div className="grid gap-3">
          {data?.integrations.map((item) => (
            <Card key={item.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="text-2xl">{item.icon}</span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{item.name}</span>
                      {item.connected && <Badge variant="success">Conectado</Badge>}
                    </div>
                    <p className="truncate text-sm text-muted-foreground">{item.description}</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={item.connected}
                    onCheckedChange={(checked) => toggle(item.id, checked, item.name)}
                    aria-label={`Conectar ${item.name}`}
                  />
                  <Button variant="ghost" size="icon" asChild aria-label={`Abrir ${item.name}`}>
                    <a href={item.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function ModeCard({
  active,
  onClick,
  icon,
  title,
  description,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-xl border p-5 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className={active ? "text-primary" : "text-muted-foreground"}>{icon}</span>
        <span className="font-medium">{title}</span>
        {active && <Badge variant="success">ativo</Badge>}
      </div>
      <p className="text-sm text-muted-foreground">{description}</p>
    </button>
  );
}
