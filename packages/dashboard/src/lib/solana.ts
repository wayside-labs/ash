import { getBase58Decoder, getBase64Encoder } from "@solana/kit";
import type { SolanaCluster } from "./schema";

export const CLUSTER_RPC_URLS: Record<SolanaCluster, string> = {
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
};

export const CLUSTER_LABELS: Record<SolanaCluster, string> = {
  devnet: "Devnet",
  testnet: "Testnet",
  "mainnet-beta": "Mainnet",
};

export const LAMPORTS_PER_SOL = 1_000_000_000;

export function getRpcUrl(cluster: SolanaCluster, customRpc?: string): string {
  return customRpc?.trim() || CLUSTER_RPC_URLS[cluster];
}

export function explorerUrl(address: string, cluster: SolanaCluster): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/address/${address}${suffix}`;
}

export function solscanAccountUrl(address: string, cluster: SolanaCluster): string {
  const base = `https://solscan.io/account/${address}`;
  return cluster === "mainnet-beta" ? base : `${base}?cluster=${cluster}`;
}

export function explorerTxUrl(signature: string, cluster: SolanaCluster): string {
  const suffix = cluster === "mainnet-beta" ? "" : `?cluster=${cluster}`;
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

/**
 * Wallet Standard-ish shape shared by the injected providers we support.
 * Phantom, Solflare and Backpack all expose this surface on `window`.
 */
export type InjectedWallet = {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string } | null;
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey?: { toBase58(): string } }>;
  disconnect: () => Promise<void>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  /** Phantom-compatible RPC surface; the only signing entry point that takes wire bytes. */
  request?: (args: { method: string; params?: unknown }) => Promise<unknown>;
  signAndSendTransaction?: (transaction: unknown) => Promise<unknown>;
};

export type WalletId = "phantom" | "solflare" | "backpack";

export const WALLETS: { id: WalletId; name: string; icon: string; site: string }[] = [
  { id: "phantom", name: "Phantom", icon: "👻", site: "https://phantom.app/" },
  { id: "solflare", name: "Solflare", icon: "🔆", site: "https://solflare.com/" },
  { id: "backpack", name: "Backpack", icon: "🎒", site: "https://backpack.app/" },
];

type WalletWindow = Window & {
  phantom?: { solana?: InjectedWallet };
  solflare?: InjectedWallet & { isSolflare?: boolean };
  backpack?: InjectedWallet;
  solana?: InjectedWallet;
};

export function getWalletProvider(id: WalletId): InjectedWallet | null {
  if (typeof window === "undefined") return null;
  const w = window as WalletWindow;
  switch (id) {
    case "phantom":
      return w.phantom?.solana ?? (w.solana?.isPhantom ? w.solana : null);
    case "solflare":
      return w.solflare ?? null;
    case "backpack":
      return w.backpack ?? null;
    default:
      return null;
  }
}

/** Kept for callers that only ever wanted Phantom. */
export function getPhantomProvider(): InjectedWallet | null {
  return getWalletProvider("phantom");
}

/**
 * The provider currently unlocked at `address`. Matching on the key rather than
 * on the stored wallet name survives the user switching accounts inside the
 * extension, which never reaches our connect flow.
 */
export function getConnectedProvider(address: string | null): InjectedWallet | null {
  if (!address) return null;
  for (const { id } of WALLETS) {
    const provider = getWalletProvider(id);
    if (provider?.publicKey?.toBase58() === address) return provider;
  }
  return null;
}

const base58 = getBase58Decoder();
const base64 = getBase64Encoder();

function readSignature(result: unknown): string | null {
  if (typeof result === "string") return result;
  if (result && typeof result === "object" && "signature" in result) {
    const sig = (result as { signature: unknown }).signature;
    if (typeof sig === "string") return sig;
    // Wallet Standard hands back raw bytes rather than base58.
    if (sig instanceof Uint8Array) return base58.decode(sig);
  }
  return null;
}

/**
 * Signs and submits a wire transaction built server-side, returning the base58
 * signature.
 *
 * The `request` form is preferred because it is the only entry point these
 * wallets expose that accepts serialized bytes — the direct
 * `signAndSendTransaction(tx)` method expects a web3.js `Transaction`, and this
 * dashboard is Kit-only on purpose. The wallet submits through its own RPC, so
 * the caller has to confirm the signature separately.
 */
export async function signAndSendTransaction(
  provider: InjectedWallet,
  base64Transaction: string,
): Promise<string> {
  const bytes = new Uint8Array(base64.encode(base64Transaction));

  if (typeof provider.request === "function") {
    const signature = readSignature(
      await provider.request({
        method: "signAndSendTransaction",
        params: { message: base58.decode(bytes) },
      }),
    );
    if (signature) return signature;
  }

  if (typeof provider.signAndSendTransaction === "function") {
    const signature = readSignature(await provider.signAndSendTransaction(bytes));
    if (signature) return signature;
  }

  throw new Error("WALLET_CANNOT_SIGN");
}
