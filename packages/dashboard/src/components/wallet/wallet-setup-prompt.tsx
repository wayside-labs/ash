"use client";

import { KeyRound, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "@/i18n/locale-provider";
import { useAppStore } from "@/stores/app-store";
import { CreateWalletDialog } from "./create-wallet-dialog";

/**
 * Asked once, to an account that signed in with Google and has no wallet
 * connected (ADR-018). Dismissal is remembered on purpose: a product that asks
 * again every visit teaches people to click past warnings, and the warnings on
 * the other side of this dialog are the ones that matter.
 *
 * Connecting is offered first because an audited extension generating a key in
 * its own process beats a web page doing it. Generation is for the visitor who
 * would otherwise have no key at all.
 */
export function WalletSetupPrompt({ onConnect }: { onConnect: () => void }) {
  const { t } = useTranslation();
  const { signedIn, loading } = useAuth();
  const { walletAddress, walletPromptDismissed, dismissWalletPrompt, hasHydrated } = useAppStore();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Waits for persist to rehydrate, otherwise the prompt flashes for someone
  // who dismissed it long ago.
  useEffect(() => {
    if (!hasHydrated || loading) return;
    if (signedIn && !walletAddress && !walletPromptDismissed) setOpen(true);
  }, [hasHydrated, loading, signedIn, walletAddress, walletPromptDismissed]);

  const dismiss = () => {
    dismissWalletPrompt();
    setOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("walletPrompt.title")}</DialogTitle>
            <DialogDescription>{t("walletPrompt.description")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Button
              className="w-full justify-start"
              onClick={() => {
                dismiss();
                onConnect();
              }}
            >
              <Wallet className="h-4 w-4" />
              {t("walletPrompt.connect")}
            </Button>
            <p className="px-1 text-xs text-muted-foreground">{t("walletPrompt.connectHint")}</p>

            <Button
              variant="outline"
              className="w-full justify-start"
              onClick={() => {
                dismiss();
                setCreating(true);
              }}
            >
              <KeyRound className="h-4 w-4" />
              {t("walletPrompt.create")}
            </Button>
            <p className="px-1 text-xs text-muted-foreground">{t("walletPrompt.createHint")}</p>
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" onClick={dismiss}>
              {t("walletPrompt.notNow")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CreateWalletDialog open={creating} onOpenChange={setCreating} />
    </>
  );
}
