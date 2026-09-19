"use client";

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
import { CLUSTER_LABELS } from "@/lib/solana";
import type { SolanaCluster } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

export default function SettingsPage() {
  const { cluster, customRpc, setCluster, setCustomRpc } = useAppStore();

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
              <Label>RPC customizado (Helius, etc.)</Label>
              <Input
                placeholder="https://devnet.helius-rpc.com/?api-key=..."
                value={customRpc}
                onChange={(e) => setCustomRpc(e.target.value)}
              />
              <Button variant="outline" size="sm">
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
            <div className="space-y-2">
              <Label>Idioma</Label>
              <Select defaultValue="pt-BR">
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (BR)</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <Label>Tema escuro</Label>
              <Switch checked disabled />
            </div>
            <div className="flex items-center justify-between">
              <Label>Notificações por email</Label>
              <Switch />
            </div>
            <div className="flex items-center justify-between">
              <Label>Alertas de limite</Label>
              <Switch defaultChecked />
            </div>
          </CardContent>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>Dados</CardTitle>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Button variant="outline">Exportar configuração</Button>
            <Button variant="destructive">Excluir conta</Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
