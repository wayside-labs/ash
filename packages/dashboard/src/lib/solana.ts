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
  /**
   * Raw message signer, which is what lets an injected provider be handed to
   * Supabase's `signInWithWeb3` directly instead of being re-wrapped.
   *
   * `solana:signIn` (SIWS) is deliberately not declared: its input and output
   * types belong to the wallet standard, and mirroring them here would drag
   * those definitions into a module that otherwise knows nothing about them.
   * Supabase reaches for `signIn` at runtime when the extension exposes it, and
   * falls back to this one -- the type only has to not lie about what we
   * promise.
   */
  signMessage?: (message: Uint8Array, encoding?: string) => Promise<Uint8Array> | undefined;
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
