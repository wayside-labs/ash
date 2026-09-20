"use client";

import { LogOut, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { getWalletProvider, WALLETS, type WalletId } from "@/lib/solana";
import { truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export function ConnectButton() {
  const { walletAddress, walletName, setWallet } = useAppStore();
  const [connecting, setConnecting] = useState<WalletId | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const toast = useToast();

  // Providers inject after hydration, so detection has to run on the client.
  useEffect(() => {
    const detect = () =>
      setInstalled(
        Object.fromEntries(WALLETS.map((w) => [w.id, getWalletProvider(w.id) !== null])),
      );
    detect();
    const timer = setTimeout(detect, 500);
    return () => clearTimeout(timer);
  }, []);

  const connect = useCallback(
    async (id: WalletId, name: string, site: string) => {
      const provider = getWalletProvider(id);
      if (!provider) {
        window.open(site, "_blank", "noopener");
        return;
      }
      setConnecting(id);
      try {
        const response = await provider.connect();
        const key = response?.publicKey ?? provider.publicKey;
        if (!key) throw new Error("a carteira não devolveu uma chave pública");
        setWallet(key.toBase58(), name);
        setDialogOpen(false);
        toast(`${name} conectada.`);
      } catch (error) {
        const message = error instanceof Error ? error.message : "conexão recusada";
        // A user-cancelled prompt is not worth an error toast.
        if (!/user rejected|denied|cancel/i.test(message)) {
          toast(`Não foi possível conectar: ${message}`, "error");
        }
      } finally {
        setConnecting(null);
      }
    },
    [setWallet, toast],
  );

  const disconnect = useCallback(async () => {
    for (const { id } of WALLETS) {
      const provider = getWalletProvider(id);
      if (provider?.publicKey) {
        await provider.disconnect().catch(() => {});
      }
    }
    setWallet(null);
    toast("Carteira desconectada.");
  }, [setWallet, toast]);

  if (walletAddress) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm sm:flex">
          <Wallet className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">{walletName ?? "Wallet"}</span>
          <span className="num text-xs">{truncateAddress(walletAddress, 4)}</span>
        </div>
        <Button variant="outline" size="sm" onClick={disconnect}>
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Desconectar</span>
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => setDialogOpen(true)}>
        <Wallet className="h-3.5 w-3.5" />
        Conectar
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Conectar carteira</DialogTitle>
            <DialogDescription>
              Escolha uma carteira Solana para operar na rede selecionada.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            {WALLETS.map((wallet) => (
              <Button
                key={wallet.id}
                variant={installed[wallet.id] ? "default" : "outline"}
                className="justify-start"
                disabled={connecting !== null}
                onClick={() => connect(wallet.id, wallet.name, wallet.site)}
              >
                <span className="text-lg">{wallet.icon}</span>
                {wallet.name}
                <span className="ml-auto text-xs opacity-70">
                  {connecting === wallet.id
                    ? "conectando…"
                    : installed[wallet.id]
                      ? "detectada"
                      : "instalar"}
                </span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
