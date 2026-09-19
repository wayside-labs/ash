"use client";

import { ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/stores/app-store";

const integrations = [
  {
    id: "jupiter",
    name: "Jupiter",
    description: "Swaps e roteamento de tokens",
    icon: "🪐",
    connected: true,
  },
  {
    id: "raydium",
    name: "Raydium",
    description: "Pools de liquidez e farming",
    icon: "💧",
    connected: false,
  },
  {
    id: "marinade",
    name: "Marinade",
    description: "Staking líquido de SOL",
    icon: "🥩",
    connected: false,
  },
  {
    id: "superteam",
    name: "Superteam Earn",
    description: "Bounties e grants para agentes",
    icon: "💰",
    connected: false,
  },
  {
    id: "squads",
    name: "Squads",
    description: "Multisig como owner do treasury",
    icon: "🛡️",
    connected: false,
  },
];

export default function IntegrationsPage() {
  const { operationMode, setOperationMode } = useAppStore();

  return (
    <div>
      <PageHeader title="Integrações" description="Conecte dApps Solana e serviços externos" />

      <Card className="mb-6 border-primary/30 bg-primary/5">
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium">Modo de operação</p>
            <p className="text-sm text-muted-foreground">
              {operationMode === "native"
                ? "Usando estrutura nativa da Solana — sua wallet assina diretamente"
                : "Usando Agent Rails Vault — pagamentos com limites e auditoria on-chain"}
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              variant={operationMode === "native" ? "default" : "outline"}
              size="sm"
              onClick={() => setOperationMode("native")}
            >
              Solana Nativo
            </Button>
            <Button
              variant={operationMode === "agent-rails" ? "default" : "outline"}
              size="sm"
              onClick={() => setOperationMode("agent-rails")}
            >
              Agent Rails Vault
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3">
        {integrations.map((item) => (
          <Card key={item.id}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl">{item.icon}</span>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    {item.connected && <Badge variant="success">Conectado</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{item.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={item.connected} />
                <Button variant="ghost" size="icon">
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
