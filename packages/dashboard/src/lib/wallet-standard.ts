import {
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";

export type SolanaChain = "solana:devnet" | "solana:mainnet";

export function solanaChain(cluster: "devnet" | "mainnet-beta"): SolanaChain {
  return cluster === "devnet" ? "solana:devnet" : "solana:mainnet";
}

function signerFor(address: string): { wallet: Wallet; account: WalletAccount } | null {
  for (const wallet of getWallets().get()) {
    if (!(SolanaSignTransaction in wallet.features)) continue;
    const account = wallet.accounts.find((a) => a.address === address);
    if (account) return { wallet, account };
  }
  return null;
}

/**
 * Signs a server-built transaction with the connected wallet and hands it back unsent.
 *
 * Through the Wallet Standard rather than `window.phantom.solana`: `solana:signTransaction`
 * takes the wire bytes as they are, which is all a Kit-only dashboard has, while the injected
 * `request()` documents only a legacy message. The header connects through the injected
 * provider, and a wallet's standard face may not list that account until asked, so a silent
 * `standard:connect` — no prompt for a site the wallet already trusts — comes first when the
 * account is missing.
 *
 * Throws `WALLET_NOT_FOUND` when no wallet holds `address` any more.
 */
export async function signWithStandardWallet(params: {
  address: string;
  transaction: Uint8Array;
  chain: SolanaChain;
  walletName?: string | null;
}): Promise<Uint8Array> {
  let found = signerFor(params.address);
  if (!found) {
    for (const wallet of getWallets().get()) {
      if (params.walletName && wallet.name !== params.walletName) continue;
      const connect = (wallet.features as Partial<StandardConnectFeature>)[StandardConnect];
      await connect?.connect({ silent: true }).catch(() => undefined);
    }
    found = signerFor(params.address);
  }
  if (!found) throw new Error("WALLET_NOT_FOUND");

  const feature = (found.wallet.features as SolanaSignTransactionFeature)[SolanaSignTransaction];
  const [output] = await feature.signTransaction({
    account: found.account,
    chain: params.chain,
    transaction: params.transaction,
  });
  if (!output) throw new Error("WALLET_CANNOT_SIGN");
  return output.signedTransaction;
}
