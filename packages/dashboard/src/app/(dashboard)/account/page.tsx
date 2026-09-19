"use client";

import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useAppStore } from "@/stores/app-store";

export default function AccountPage() {
  const { googleEmail, setGoogleEmail } = useAppStore();

  const handleGoogleLogin = () => {
    setGoogleEmail("usuario@gmail.com");
  };

  return (
    <div>
      <PageHeader title="Account" description="Dados de acesso e segurança" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Login</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {googleEmail ? (
              <div>
                <Label>Google</Label>
                <p className="text-sm">{googleEmail}</p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => setGoogleEmail(null)}
                >
                  Desconectar
                </Button>
              </div>
            ) : (
              <Button onClick={handleGoogleLogin} className="w-full">
                Entrar com Google
              </Button>
            )}
            <Separator />
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" placeholder="seu@email.com" />
            </div>
            <div className="space-y-2">
              <Label>Senha</Label>
              <Input type="password" placeholder="••••••••" />
            </div>
            <Button variant="outline">Alterar senha</Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Segurança</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Autenticação em 2 fatores</p>
                <p className="text-xs text-muted-foreground">
                  Recomendado para contas com treasury
                </p>
              </div>
              <Button variant="outline" size="sm">
                Ativar
              </Button>
            </div>
            <Separator />
            <div>
              <p className="text-sm font-medium">Sessões ativas</p>
              <p className="text-xs text-muted-foreground">1 dispositivo conectado</p>
            </div>
            <Button variant="destructive" size="sm">
              Encerrar todas as sessões
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
