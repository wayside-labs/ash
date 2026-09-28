/**
 * Canonical mints, so no package has to carry its own copy of an address a user
 * will recognise.
 *
 * Two separate things live here and they are deliberately not the same lookup:
 *
 * - `KNOWN_MINTS` maps a **mint address** to a ticker. It is cluster-free on
 *   purpose — devnet USDC and mainnet USDC are different addresses, so an
 *   address alone already says which chain it belongs to, and a renderer that
 *   only has a mint can name it without being told the cluster.
 * - `usdcMintFor` goes the other way, cluster to address, for the one place
 *   that has to *choose* a mint rather than describe one.
 *
 * Nothing here is authoritative: `decimals` is what the mint is known to use,
 * but every amount conversion still reads the owner-configured `MintConfig` on
 * the treasury account (see `units.ts`). These values name things; they never
 * decide what a payment is worth.
 */

import { NATIVE_MINT } from "./constants.js";

export const USDC_DECIMALS = 6;
export const USDT_DECIMALS = 6;

/** Circle's devnet USDC. */
export const USDC_MINT_DEVNET = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU" as const;

/** Circle's mainnet USDC. */
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v" as const;

/**
 * Tether's mainnet USDT.
 *
 * There is no devnet counterpart, and that is not an omission: Tether issues no devnet
 * token, so `usdtMintFor("devnet")` answers `null` rather than pointing a deposit at a mint
 * account that does not exist. The same reasoning `usdcMintFor` applies to testnet.
 */
export const USDT_MINT_MAINNET = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB" as const;

/** Cluster monikers as Solana's RPC and the dashboard spell them. */
export type ClusterMoniker = "devnet" | "testnet" | "mainnet-beta";

export type KnownMint = {
  symbol: string;
  decimals: number;
  /** `"any"` for the native sentinel, which is the same address everywhere. */
  cluster: ClusterMoniker | "any";
  /** A dollar-pegged mint may be priced 1:1 instead of needing a feed. */
  stable: boolean;
};

export const KNOWN_MINTS: Readonly<Record<string, KnownMint>> = Object.freeze({
  [NATIVE_MINT]: { symbol: "SOL", decimals: 9, cluster: "any", stable: false },
  [USDC_MINT_DEVNET]: {
    symbol: "USDC",
    decimals: USDC_DECIMALS,
    cluster: "devnet",
    stable: true,
  },
  [USDC_MINT_MAINNET]: {
    symbol: "USDC",
    decimals: USDC_DECIMALS,
    cluster: "mainnet-beta",
    stable: true,
  },
  [USDT_MINT_MAINNET]: {
    symbol: "USDT",
    decimals: USDT_DECIMALS,
    cluster: "mainnet-beta",
    stable: true,
  },
});

export function knownMint(mint: string): KnownMint | null {
  return KNOWN_MINTS[mint] ?? null;
}

/** Ticker for a mint we ship an entry for; `null` means "render the address". */
export function knownMintSymbol(mint: string): string | null {
  return KNOWN_MINTS[mint]?.symbol ?? null;
}

/**
 * The USDC mint for a cluster, or `null` where Circle does not issue one.
 *
 * Testnet is the `null` case and it is not an oversight: there is no canonical
 * USDC there, and returning some other cluster's address would have the UI
 * offer a deposit into a mint account that does not exist.
 */
export function usdcMintFor(cluster: ClusterMoniker): string | null {
  switch (cluster) {
    case "devnet":
      return USDC_MINT_DEVNET;
    case "mainnet-beta":
      return USDC_MINT_MAINNET;
    default:
      return null;
  }
}

/**
 * The USDT mint for a cluster, or `null` where Tether does not issue one — which is
 * everywhere except mainnet.
 */
export function usdtMintFor(cluster: ClusterMoniker): string | null {
  return cluster === "mainnet-beta" ? USDT_MINT_MAINNET : null;
}

/** True for the native-SOL sentinel, which never has a token account. */
export function isNativeMint(mint: string): boolean {
  return mint === NATIVE_MINT;
}
