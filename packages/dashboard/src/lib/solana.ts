import type { SolanaCluster } from "./types";

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

export function getRpcUrl(cluster: SolanaCluster, customRpc?: string): string {
  return customRpc?.trim() || CLUSTER_RPC_URLS[cluster];
}

export type PhantomProvider = {
  isPhantom?: boolean;
  publicKey?: { toBase58(): string };
  connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
  disconnect: () => Promise<void>;
  on: (event: string, handler: () => void) => void;
  removeListener: (event: string, handler: () => void) => void;
};

export function getPhantomProvider(): PhantomProvider | null {
  if (typeof window === "undefined") return null;
  const provider = (window as Window & { phantom?: { solana?: PhantomProvider } }).phantom?.solana;
  if (provider?.isPhantom) return provider;
  return null;
}
