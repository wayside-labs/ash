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
import { useTranslation } from "@/i18n/locale-provider";
import { getWalletProvider, WALLETS, type WalletId } from "@/lib/solana";
import { truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export function ConnectButton() {
  const { walletAddress, walletName, setWallet } = useAppStore();
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
      <div className="flex items-center gap-2">
        <div className="hidden items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5 text-sm sm:flex">
          <Wallet className="h-3.5 w-3.5 text-primary" />
          <span className="text-muted-foreground">{walletName ?? t("wallet.defaultName")}</span>
          <span className="num text-xs">{truncateAddress(walletAddress, 4)}</span>
        </div>
        <Button variant="outline" size="sm" onClick={disconnect}>
          <LogOut className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("wallet.disconnect")}</span>
        </Button>
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
