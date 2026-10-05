import { parseAllowedWallets, parseContacts } from "@ash/cloak";

/**
 * A browser-friendly mainnet RPC. The Solana public endpoint answers 403 to a browser origin, so
 * the default is one that does not; an operator who wants more headroom sets their own.
 */
export const DEFAULT_CLOAK_RPC_URL = "https://solana-rpc.publicnode.com";

export type CloakRunConfig = {
  /** The template's mainnet exception is off unless the install turned it on (ADR-027). */
  mainnetEnabled: boolean;
  rpcUrl: string;
  /** Wallets allowed to run it. Empty allows nobody. */
  allowedWallets: string[];
  /** The operator's contacts, label to address. Empty allows no payee. */
  contacts: Map<string, string>;
  /** The UI suite only: a stand-in for Cloak, never set on a real install. */
  fakeSdk: boolean;
};

/**
 * Read at call time, with every variable spelled out: Next inlines `NEXT_PUBLIC_*` into the
 * bundle only where the full name appears, and they are public by construction — nothing here
 * is a secret.
 */
export function cloakRunConfig(): CloakRunConfig {
  const rpc = process.env.NEXT_PUBLIC_CLOAK_RPC_URL?.trim();
  return {
    mainnetEnabled: process.env.NEXT_PUBLIC_CLOAK_MAINNET === "1",
    rpcUrl: rpc ? rpc : DEFAULT_CLOAK_RPC_URL,
    allowedWallets: parseAllowedWallets(process.env.NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS),
    contacts: parseContacts(process.env.NEXT_PUBLIC_CLOAK_CONTACTS),
    fakeSdk: process.env.NEXT_PUBLIC_CLOAK_FAKE_SDK === "1",
  };
}
