"use client";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export default function ProfilePage() {
  const { walletAddress } = useAppStore();

  return (
    <div>
      <PageHeader title="Profile" description="Seu perfil e wallet principal" />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>Informações pessoais</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted text-2xl">
              👤
            </div>
            <Button variant="outline" size="sm">
              Alterar foto
            </Button>
          </div>
          <div className="space-y-2">
            <Label>Nome de exibição</Label>
            <Input placeholder="Seu nome" />
          </div>
          <div className="space-y-2">
            <Label>Empresa</Label>
            <Input placeholder="Nome da empresa" />
          </div>
          <div className="space-y-2">
            <Label>Bio</Label>
            <Textarea placeholder="Conte um pouco sobre você..." rows={3} />
          </div>
          <div className="space-y-2">
            <Label>Wallet principal</Label>
            <Input
              readOnly
              value={walletAddress ? truncateAddress(walletAddress, 8) : "Nenhuma wallet conectada"}
              className="font-mono"
            />
          </div>
          <Button>Salvar alterações</Button>
        </CardContent>
      </Card>
    </div>
  );
}
