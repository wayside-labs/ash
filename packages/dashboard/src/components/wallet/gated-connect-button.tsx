"use client";

import { useExternalWalletsAllowed } from "@/hooks/use-account-wallet";
import { ConnectButton } from "./connect-button";

/**
 * Connect, behind the ADR-024 gate, for the page headers that sign (Treasury, Wallets, Limits,
 * Agents). Renders nothing while the plan is loading, so a Pro user never sees the button blink
 * out and back, and a free user never sees an extension picker they cannot use. Reconnecting a
 * trusted wallet on load is `WalletAutoRestore`'s job, not this button's.
 */
export function GatedConnectButton() {
  const allowed = useExternalWalletsAllowed();
  return allowed ? <ConnectButton /> : null;
}
