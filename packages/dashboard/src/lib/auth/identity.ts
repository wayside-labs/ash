import type { User } from "@supabase/supabase-js";

/**
 * Which door the user came through, and the stable handle for it.
 *
 * `subject` is what `identities.subject` stores and what `unique (provider,
 * subject)` dedupes on, so it has to be stable across sign-ins: Google's `sub`
 * never changes, and a wallet address is the wallet.
 */
export type ResolvedIdentity = {
  provider: "google" | "wallet";
  subject: string;
  displayName: string;
  email: string;
};

/** Base58, 32 bytes: the shape a Solana address has and a UUID does not. */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function firstAddress(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && BASE58_ADDRESS.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Supabase reports web3 sign-in under more than one provider name depending on
 * the release, so match on the family rather than on one string.
 */
function isWeb3Provider(provider: string | undefined): boolean {
  return provider === "web3" || provider === "solana";
}

/**
 * Reads the account's identity from the authenticated user, and from nothing
 * else. The wallet address in particular is never taken from the request body:
 * a caller that could name its own address could claim someone else's.
 *
 * Throws rather than guessing. A wrong `subject` here writes an identity row
 * that either collides with a stranger's or strands this user from their own
 * org on the next sign-in, and both are worse than a visible failure.
 */
export function resolveIdentity(user: User): ResolvedIdentity {
  const identities = user.identities ?? [];

  const google = identities.find((row) => row.provider === "google");
  if (google) {
    const sub = asRecord(google.identity_data).sub;
    return {
      provider: "google",
      subject: typeof sub === "string" && sub.length > 0 ? sub : user.id,
      displayName: displayNameFor(user, null),
      email: user.email ?? "",
    };
  }

  const web3 = identities.find((row) => isWeb3Provider(row.provider));
  const metadata = asRecord(user.user_metadata);
  const address = firstAddress(
    web3 ? asRecord(web3.identity_data).address : undefined,
    web3?.id,
    metadata.address,
    asRecord(metadata.custom_claims).address,
  );

  if (web3 || address) {
    if (!address) {
      throw new Error("web3 sign-in carried no wallet address");
    }
    return {
      provider: "wallet",
      subject: address,
      displayName: displayNameFor(user, address),
      // Wallet accounts carry no email (ADR-017). The column is `not null
      // default ''`, so absence is empty, never a placeholder that looks real.
      email: user.email ?? "",
    };
  }

  throw new Error(`unsupported sign-in provider: ${user.app_metadata?.provider ?? "unknown"}`);
}

/** `7xKXtg2C…9fAsU` reads as an account; a raw 44-character key does not. */
export function truncateAddressForName(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

function displayNameFor(user: User, address: string | null): string {
  const metadata = asRecord(user.user_metadata);
  const fullName = metadata.full_name;
  if (typeof fullName === "string" && fullName.trim().length > 0) return fullName.trim();
  const local = user.email?.split("@")[0];
  if (local) return local;
  if (address) return truncateAddressForName(address);
  return "User";
}

/**
 * The same resolution, for callers that only want to render something. The UI
 * showing a blank label is a cosmetic miss; the bootstrap writing a wrong
 * `subject` is not, which is why only one of the two is allowed to shrug.
 */
export function tryResolveIdentity(user: User | null | undefined): ResolvedIdentity | null {
  if (!user) return null;
  try {
    return resolveIdentity(user);
  } catch {
    return null;
  }
}
