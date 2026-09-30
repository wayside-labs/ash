"use client";

import { useEffect, useRef } from "react";
import { useExternalWalletsAllowed } from "@/hooks/use-account-wallet";
import { getWalletProvider, WALLETS } from "@/lib/solana";
import { useAppStore } from "@/stores/app-store";

/**
 * Reconnects a wallet the extension still trusts, once per page load, wherever the viewer lands.
 * This used to live in the header's Connect button; with Connect moved into the pages that sign,
 * a reload on /workflows would otherwise leave the store empty while the extension is still
 * authorised — and a workflow created in that window is written with no on-chain owner.
 *
 * `onlyIfTrusted` never prompts. A free hosted account (ADR-024) gets no restore, and a wallet
 * left in the store from before the gate is cleared — tidiness, not enforcement.
 */
export function WalletAutoRestore() {
  const allowed = useExternalWalletsAllowed();
  const walletAddress = useAppStore((s) => s.walletAddress);
  const setWallet = useAppStore((s) => s.setWallet);
  const attempted = useRef(false);

  useEffect(() => {
    if (allowed === false && walletAddress) setWallet(null);
  }, [allowed, walletAddress, setWallet]);

  useEffect(() => {
    if (!allowed || attempted.current) return;
    attempted.current = true;
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

    // Extensions inject late, so this retries once after half a second.
    void (async () => {
      if (await restore()) return;
      await new Promise<void>((resolve) => setTimeout(() => resolve(), 500));
      if (!cancelled) await restore();
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, setWallet]);

  return null;
}
