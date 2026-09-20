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
