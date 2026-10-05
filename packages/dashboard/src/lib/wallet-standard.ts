import {
  SolanaSignMessage,
  type SolanaSignMessageFeature,
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { StandardConnect, type StandardConnectFeature } from "@wallet-standard/features";
import { getConnectedProvider } from "@/lib/solana";

export type SolanaChain = "solana:devnet" | "solana:testnet" | "solana:mainnet";

export function solanaChain(cluster: "devnet" | "testnet" | "mainnet-beta"): SolanaChain {
  return cluster === "mainnet-beta" ? "solana:mainnet" : `solana:${cluster}`;
}

function signerFor(
  address: string,
  feature: string = SolanaSignTransaction,
): { wallet: Wallet; account: WalletAccount } | null {
  for (const wallet of getWallets().get()) {
    if (!(feature in wallet.features)) continue;
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

/** Wallets disagree on the shape: some return the bytes, Phantom wraps them in an object. */
function signatureBytes(result: unknown): Uint8Array | null {
  if (result instanceof Uint8Array) return result;
  if (result && typeof result === "object" && "signature" in result) {
    const signature = (result as { signature: unknown }).signature;
    if (signature instanceof Uint8Array) return signature;
  }
  return null;
}

/**
 * The raw 64-byte signature the connected wallet makes over `message`.
 *
 * Wallet Standard first (`solana:signMessage`), then the injected provider the header connected
 * through, because a wallet's standard face may not list the account or the feature. Cloak
 * needs this twice: to authenticate each relay request and to derive the payout keys, which is
 * why a wallet that cannot do it fails here, before anything is shielded.
 *
 * Throws `WALLET_CANNOT_SIGN_MESSAGES` when neither path can.
 */
export async function signMessageWithStandardWallet(params: {
  address: string;
  message: Uint8Array;
  walletName?: string | null;
}): Promise<Uint8Array> {
  let found = signerFor(params.address, SolanaSignMessage);
  if (!found) {
    for (const wallet of getWallets().get()) {
      if (params.walletName && wallet.name !== params.walletName) continue;
      const connect = (wallet.features as Partial<StandardConnectFeature>)[StandardConnect];
      await connect?.connect({ silent: true }).catch(() => undefined);
    }
    found = signerFor(params.address, SolanaSignMessage);
  }
  if (found) {
    const feature = (found.wallet.features as SolanaSignMessageFeature)[SolanaSignMessage];
    const [output] = await feature.signMessage({ account: found.account, message: params.message });
    const signature = signatureBytes(output);
    if (signature) return signature;
  }
  const provider = getConnectedProvider(params.address);
  if (provider?.signMessage) {
    const signature = signatureBytes(await provider.signMessage(params.message, "utf8"));
    if (signature) return signature;
  }
  throw new Error("WALLET_CANNOT_SIGN_MESSAGES");
}

/**
 * The connected wallet as the Cloak adapter wants it: a message signer and a transaction signer
 * that hands back signed wire bytes. The chain is mainnet whatever cluster the dashboard shows,
 * because the private payout template runs nowhere else.
 */
export function standardWalletHandle(params: { address: string; walletName?: string | null }): {
  address: string;
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  signTransaction: (transaction: Uint8Array) => Promise<Uint8Array>;
} {
  const walletName = params.walletName ?? null;
  return {
    address: params.address,
    signMessage: (message) =>
      signMessageWithStandardWallet({ address: params.address, message, walletName }),
    signTransaction: (transaction) =>
      signWithStandardWallet({
        address: params.address,
        transaction,
        chain: solanaChain("mainnet-beta"),
        walletName,
      }),
  };
}
