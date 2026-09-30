"use client";

import { useEffect } from "react";
import { useExternalWalletsAllowed } from "@/hooks/use-account-wallet";
import { useAppStore } from "@/stores/app-store";
import { ConnectButton } from "./connect-button";

/**
 * The header's wallet control, behind the ADR-024 gate. Renders nothing while the plan is
 * loading, so a Pro user never sees the button blink out and back, and a free user never sees
 * an extension picker they cannot use.
 *
 * A free account with a wallet still in the store — connected before the gate existed, or by
 * hand from devtools — is disconnected here. That is tidiness, not enforcement: what a wallet
 * can do is decided on chain.
 */
export function GatedConnectButton() {
  const allowed = useExternalWalletsAllowed();
  const walletAddress = useAppStore((s) => s.walletAddress);
  const setWallet = useAppStore((s) => s.setWallet);

  useEffect(() => {
    if (allowed === false && walletAddress) setWallet(null);
  }, [allowed, walletAddress, setWallet]);

  return allowed ? <ConnectButton /> : null;
}
