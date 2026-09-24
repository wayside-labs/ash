"use client";

import { Loader2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "@/i18n/locale-provider";
import { getWalletProvider, WALLETS, type WalletId } from "@/lib/solana";

/**
 * The second door of ADR-017: the wallet signs a statement and becomes an
 * identity in its own right, with no email attached.
 *
 * Only installed wallets are offered. An uninstalled one here would send the
 * user to an install page mid-sign-in, which is a worse dead end than not
 * showing the button.
 */
export function WalletSignInButton() {
  const { t } = useTranslation();
  const toast = useToast();
  const { signInWithWallet } = useAuth();
  const [installed, setInstalled] = useState<WalletId[]>([]);
  const [pending, setPending] = useState<WalletId | null>(null);

  useEffect(() => {
    // Extensions inject late; same schedule the connect button uses.
    const detect = () =>
      setInstalled(WALLETS.filter((w) => getWalletProvider(w.id) !== null).map((w) => w.id));
    detect();
    const timer = setTimeout(detect, 500);
    return () => clearTimeout(timer);
  }, []);

  if (installed.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {WALLETS.filter((w) => installed.includes(w.id)).map((wallet) => (
        <Button
          key={wallet.id}
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={async () => {
            setPending(wallet.id);
            try {
              await signInWithWallet(wallet.id);
            } catch (error) {
              const message = error instanceof Error ? error.message : t("account.authError");
              // A refused signature is a decision, not a failure to report.
              if (!/user rejected|denied|cancel/i.test(message)) {
                toast(message, "error");
              }
            } finally {
              setPending(null);
            }
          }}
        >
          {pending === wallet.id ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Wallet className="h-3.5 w-3.5" />
          )}
          {t("account.signInWithWallet", { name: wallet.name })}
        </Button>
      ))}
    </div>
  );
}
