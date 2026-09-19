"use client";

import { LogOut, Wallet } from "lucide-react";
import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getPhantomProvider } from "@/lib/solana";
import { truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export function ConnectButton() {
  const { walletAddress, walletName, setWallet } = useAppStore();
  const [connecting, setConnecting] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  const connectPhantom = useCallback(async () => {
    setConnecting(true);
    try {
      const provider = getPhantomProvider();
      if (!provider) {
        window.open("https://phantom.app/", "_blank");
        return;
      }
      const response = await provider.connect();
      setWallet(response.publicKey.toBase58(), "Phantom");
      setDialogOpen(false);
    } catch {
      // User rejected or wallet unavailable
    } finally {
      setConnecting(false);
    }
  }, [setWallet]);

  const disconnect = useCallback(async () => {
    const provider = getPhantomProvider();
    if (provider) {
      try {
        await provider.disconnect();
      } catch {
        // ignore
      }
    }
    setWallet(null);
  }, [setWallet]);

  if (walletAddress) {
    return (
      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm sm:flex">
          <Wallet className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">{walletName ?? "Wallet"}</span>
          <span className="font-mono text-xs">{truncateAddress(walletAddress, 4)}</span>
        </div>
        <Button variant="outline" size="sm" onClick={disconnect}>
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Disconnect</span>
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => setDialogOpen(true)}>
        <Wallet className="h-3.5 w-3.5" />
        Connect Wallet
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conectar carteira</DialogTitle>
            <DialogDescription>
              Escolha uma carteira Solana para operar na rede selecionada.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Button onClick={connectPhantom} disabled={connecting} className="justify-start">
              <span className="text-lg">👻</span>
              Phantom
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => window.open("https://solflare.com/", "_blank")}
            >
              <span className="text-lg">🔆</span>
              Solflare
            </Button>
            <Button
              variant="outline"
              className="justify-start"
              onClick={() => window.open("https://backpack.app/", "_blank")}
            >
              <span className="text-lg">🎒</span>
              Backpack
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
