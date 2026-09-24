"use client";

import { LogOut, Wallet } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/i18n/locale-provider";
import { getWalletProvider, WALLETS, type WalletId } from "@/lib/solana";
import { useAppStore } from "@/stores/app-store";
import { WalletBalance } from "./wallet-balance";

export function ConnectButton() {
  const { walletAddress, setWallet } = useAppStore();
  const { t } = useTranslation();
  const [connecting, setConnecting] = useState<WalletId | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [installed, setInstalled] = useState<Record<string, boolean>>({});
  const toast = useToast();

  useEffect(() => {
    const detect = () =>
      setInstalled(
        Object.fromEntries(WALLETS.map((w) => [w.id, getWalletProvider(w.id) !== null])),
      );
    detect();
    const timer = setTimeout(detect, 500);
    return () => clearTimeout(timer);
  }, []);

  // A reload drops the store but not the extension's authorisation, so without
  // this the header offers "connect" while the wallet is still trusted -- and a
  // workflow created in that window is written with no on-chain owner at all.
  //
  // `onlyIfTrusted` never prompts: it resolves when the origin is still
  // authorised and rejects otherwise. Guarded by a ref rather than by
  // `walletAddress` so that disconnecting does not immediately reconnect.
  const eagerAttempted = useRef(false);
  useEffect(() => {
    if (eagerAttempted.current) return;
    eagerAttempted.current = true;
    let cancelled = false;

    const restore = async (): Promise<boolean> => {
      for (const { id, name } of WALLETS) {
        const provider = getWalletProvider(id);
        if (!provider) continue;
        try {
          const response = await provider.connect({ onlyIfTrusted: true });
          const key = response?.publicKey ?? provider.publicKey;
          if (key) {
            if (!cancelled) setWallet(key.toBase58(), name);
            return true;
          }
        } catch {
          // Not trusted for this origin, or revoked. Try the next wallet.
        }
      }
      return false;
    };

    // Extensions inject late, so this retries once on the same schedule as the
    // detection above.
    const run = async () => {
      if (await restore()) return;
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));
      if (!cancelled) await restore();
    };
    void run();

    return () => {
      cancelled = true;
    };
  }, [setWallet]);

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
        if (!key) throw new Error(t("wallet.error.noPublicKey"));
        setWallet(key.toBase58(), name);
        setDialogOpen(false);
        toast(t("common.walletConnected", { name }));
      } catch (error) {
        const message =
          error instanceof Error ? error.message : t("wallet.error.connectionRefused");
        if (!/user rejected|denied|cancel/i.test(message)) {
          toast(t("wallet.error.couldNotConnect", { message }), "error");
        }
      } finally {
        setConnecting(null);
      }
    },
    [setWallet, toast, t],
  );

  const disconnect = useCallback(async () => {
    for (const { id } of WALLETS) {
      const provider = getWalletProvider(id);
      if (provider?.publicKey) {
        await provider.disconnect().catch(() => {});
      }
    }
    setWallet(null);
    toast(t("common.walletDisconnected"));
  }, [setWallet, toast, t]);

  if (walletAddress) {
    return (
      <div className="flex items-center gap-1">
        <WalletBalance address={walletAddress} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={disconnect}>
              <LogOut className="h-3.5 w-3.5" />
              <span className="sr-only">{t("wallet.disconnect")}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t("wallet.disconnect")}</TooltipContent>
        </Tooltip>
      </div>
    );
  }

  return (
    <>
      <Button size="sm" onClick={() => setDialogOpen(true)}>
        <Wallet className="h-3.5 w-3.5" />
        {t("wallet.connect")}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("wallet.dialog.title")}</DialogTitle>
            <DialogDescription>{t("wallet.dialog.description")}</DialogDescription>
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
                    ? t("wallet.status.connecting")
                    : installed[wallet.id]
                      ? t("wallet.status.detected")
                      : t("wallet.status.install")}
                </span>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
