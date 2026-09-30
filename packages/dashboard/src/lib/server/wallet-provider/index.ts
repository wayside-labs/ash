import { generateKeyPair, getAddressFromPublicKey } from "@solana/kit";

/**
 * Who can sign for a platform wallet's address (ADR-024). Stored beside the wallet and read by
 * the UI before it offers anything that would send funds there.
 */
export type WalletCustody = "none" | "provider";

export type ProvisionedWallet = {
  publicKey: string;
  provider: string;
  providerWalletId: string | null;
  custody: WalletCustody;
  /** Kept for support. Never key material: this lands in a table the user can read. */
  metadata: Record<string, unknown>;
};

/**
 * The seam an embedded-wallet vendor plugs into. Server-side because every vendor ADR-024
 * weighs provisions through an authenticated server API; the account id is the vendor's
 * external user reference, so a retried provision finds the same wallet rather than a second.
 */
export interface PlatformWalletProvider {
  readonly id: string;
  readonly custody: WalletCustody;
  provision(input: { accountId: string }): Promise<ProvisionedWallet>;
}

/**
 * Development stand-in: a real, valid address whose private key is thrown away before this
 * function returns. Nobody — not the server, not the user, not a vendor — can ever sign for it,
 * which is exactly what `custody: "none"` tells the UI, and why the UI offers no deposit
 * action for it. It exists so that the account page, the balance read and every code path
 * that expects a wallet row can be built and tested before the vendor decision is made.
 *
 * Generated with WebCrypto as a non-extractable key: the private half cannot be read out
 * even by mistake, so "thrown away" is a property of the API, not of this code's discipline.
 */
export const stubWalletProvider: PlatformWalletProvider = {
  id: "stub",
  custody: "none",
  async provision() {
    const { publicKey } = await generateKeyPair();
    return {
      publicKey: await getAddressFromPublicKey(publicKey),
      provider: "stub",
      providerWalletId: null,
      custody: "none",
      metadata: { note: "development stub; no key exists for this address" },
    };
  },
};

const PROVIDERS: Record<string, PlatformWalletProvider> = {
  stub: stubWalletProvider,
};

/**
 * `PLATFORM_WALLET_PROVIDER`, defaulting to the stub. An unknown name throws rather than
 * falling back: a typo in production quietly handing every new user a keyless address is the
 * failure this must not have.
 */
export function platformWalletProvider(
  name = process.env.PLATFORM_WALLET_PROVIDER,
): PlatformWalletProvider {
  const key = name?.trim() || "stub";
  const provider = PROVIDERS[key];
  if (!provider) {
    throw new Error(`unknown PLATFORM_WALLET_PROVIDER: ${key}`);
  }
  return provider;
}
