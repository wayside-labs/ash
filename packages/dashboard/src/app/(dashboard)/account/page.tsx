"use client";

import { Info, LogOut } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/toast";
import { ConnectButton } from "@/components/wallet/connect-button";
import { truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export default function AccountPage() {
  const { walletAddress, walletName, setWallet } = useAppStore();
  const toast = useToast();

  return (
    <div>
      <PageHeader title="Account" description="Como você se identifica neste dashboard" />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Identidade</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {walletAddress ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">Carteira conectada</p>
                  <p className="num text-sm">{truncateAddress(walletAddress, 8)}</p>
                  {walletName && <p className="text-xs text-muted-foreground">{walletName}</p>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setWallet(null);
                    toast("Carteira desconectada.");
                  }}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Desconectar
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  Sua carteira é a identidade deste dashboard. Nada aqui exige senha.
                </p>
                <ConnectButton />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Login por email e Google</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Ainda não existe. O botão anterior apenas gravava um email fixo no navegador, o que
                dava a impressão de uma sessão que nunca houve — por isso foi removido em vez de
                mantido como enfeite.
              </p>
            </div>
            <Separator />
            <p className="text-xs text-muted-foreground">
              Para autenticação real, o caminho é um provedor de identidade (NextAuth ou Privy) com
              sessão no servidor. Enquanto isso, a carteira conectada cumpre o papel.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
