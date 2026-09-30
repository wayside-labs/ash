"use client";

import { getBase64Decoder } from "@solana/kit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "@/hooks/use-dashboard";
import type { AccountWalletSummary } from "@/lib/server/auth/platform-wallet";
import { getConnectedProvider } from "@/lib/solana";
import { linkMessage } from "@/lib/wallet-link";

const KEY = ["account-wallet"] as const;

/** Plan, platform wallet and linked wallets (ADR-024). */
export function useAccountWallet() {
  return useQuery({
    queryKey: KEY,
    queryFn: () => request<AccountWalletSummary>("/api/account/wallet"),
    staleTime: 60_000,
  });
}

/**
 * Whether this viewer may see the external-wallet surface. `undefined` while the answer is
 * loading, so callers can wait instead of flashing a Pro lock at a Pro user.
 */
export function useExternalWalletsAllowed(): boolean | undefined {
  return useAccountWallet().data?.externalWallets;
}

/** Wallets disagree on the shape: some return the bytes, Phantom wraps them in an object. */
function signatureBytes(result: unknown): Uint8Array | null {
  if (result instanceof Uint8Array) return result;
  if (result && typeof result === "object" && "signature" in result) {
    const sig = (result as { signature: unknown }).signature;
    if (sig instanceof Uint8Array) return sig;
  }
  return null;
}

/** Asks the connected extension to sign the link statement, then hands the proof to the server. */
export function useLinkWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { accountId: string; address: string; walletName: string }) => {
      const provider = getConnectedProvider(input.address);
      if (!provider?.signMessage) throw new Error("this wallet cannot sign messages");
      const message = linkMessage(input.accountId, new Date());
      const signature = signatureBytes(
        await provider.signMessage(new TextEncoder().encode(message), "utf8"),
      );
      if (!signature) throw new Error("the wallet returned no signature");
      return request<{ linked: string }>("/api/account/wallet/link", {
        method: "POST",
        body: JSON.stringify({
          address: input.address,
          message,
          signature: getBase64Decoder().decode(signature),
          walletName: input.walletName,
        }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUnlinkWallet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (address: string) =>
      request<{ unlinked: string }>("/api/account/wallet/link", {
        method: "DELETE",
        body: JSON.stringify({ address }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}

/** Re-runs the bootstrap, which provisions a missing platform wallet and nothing else new. */
export function useRetryProvisioning() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => request<{ accountId: string }>("/api/auth/bootstrap", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: KEY }),
  });
}
