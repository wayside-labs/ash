import {
  type Address,
  getBase64Encoder,
  getPublicKeyFromAddress,
  type SignatureBytes,
  address as toAddress,
  verifySignature,
} from "@solana/kit";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  canConnectExternalWallet,
  type ExternalWalletPolicy,
  type Plan,
  parseExternalWalletPolicy,
} from "@/lib/plan";
import {
  type PlatformWalletProvider,
  platformWalletProvider,
  type WalletCustody,
} from "@/lib/server/wallet-provider";
import { LINK_MESSAGE_MAX_AGE_MS, parseLinkMessage } from "@/lib/wallet-link";

export type PlatformWalletRow = {
  publicKey: string;
  provider: string;
  custody: WalletCustody;
  createdAt: string;
};

export type LinkedWalletRow = { address: string; walletName: string; linkedAt: string };

/** What `GET /api/account/wallet` answers; also the shape the account page renders from. */
export type AccountWalletSummary = {
  hosted: boolean;
  /** Named in the link statement a wallet signs; the server re-checks it against the session. */
  accountId: string | null;
  plan: Plan;
  externalWallets: boolean;
  platformWallet: PlatformWalletRow | null;
  linkedWallets: LinkedWalletRow[];
};

export function externalWalletPolicy(): ExternalWalletPolicy {
  return parseExternalWalletPolicy(process.env.DASHBOARD_EXTERNAL_WALLETS);
}

const UNIQUE_VIOLATION = "23505";

/**
 * Idempotent on `platform_wallets.account_id`. Two sign-ins racing (the Google callback and a
 * second tab's bootstrap) both provision; the loser's insert hits the primary key and it reads
 * the winner's row back. With the stub the loser's address is simply dropped; with a vendor,
 * the account id is the vendor's idempotency key, so both calls got the same wallet anyway.
 */
export async function ensurePlatformWallet(
  admin: SupabaseClient,
  accountId: string,
  provider: PlatformWalletProvider = platformWalletProvider(),
): Promise<PlatformWalletRow> {
  const existing = await readPlatformWallet(admin, accountId);
  if (existing) return existing;

  const wallet = await provider.provision({ accountId });
  const { error } = await admin.from("platform_wallets").insert({
    account_id: accountId,
    public_key: wallet.publicKey,
    provider: wallet.provider,
    provider_wallet_id: wallet.providerWalletId,
    custody: wallet.custody,
    metadata: wallet.metadata,
  });
  if (error && error.code !== UNIQUE_VIOLATION) throw error;

  const row = await readPlatformWallet(admin, accountId);
  if (!row) throw new Error("platform wallet insert returned no row");
  return row;
}

export async function readPlatformWallet(
  client: SupabaseClient,
  accountId: string,
): Promise<PlatformWalletRow | null> {
  const { data, error } = await client
    .from("platform_wallets")
    .select("public_key, provider, custody, created_at")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    publicKey: data.public_key,
    provider: data.provider,
    custody: data.custody,
    createdAt: data.created_at,
  };
}

/** No row means free: entitlements are written by billing, and most accounts never get one. */
export async function readPlan(client: SupabaseClient, accountId: string): Promise<Plan> {
  const { data, error } = await client
    .from("account_entitlements")
    .select("plan")
    .eq("account_id", accountId)
    .maybeSingle();
  if (error) throw error;
  return data?.plan === "pro" ? "pro" : "free";
}

export async function readLinkedWallets(
  client: SupabaseClient,
  accountId: string,
): Promise<LinkedWalletRow[]> {
  const { data, error } = await client
    .from("linked_wallets")
    .select("address, wallet_name, linked_at")
    .eq("account_id", accountId)
    .order("linked_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    address: row.address,
    walletName: row.wallet_name,
    linkedAt: row.linked_at,
  }));
}

export async function readAccountWallet(
  client: SupabaseClient,
  accountId: string,
): Promise<AccountWalletSummary> {
  const [plan, platformWallet, linkedWallets] = await Promise.all([
    readPlan(client, accountId),
    readPlatformWallet(client, accountId),
    readLinkedWallets(client, accountId),
  ]);
  return {
    hosted: true,
    accountId,
    plan,
    externalWallets: canConnectExternalWallet({
      hosted: true,
      plan,
      policy: externalWalletPolicy(),
    }),
    platformWallet,
    linkedWallets,
  };
}

export type LinkProofResult =
  | { ok: true; address: Address }
  | { ok: false; reason: "malformed" | "wrong-account" | "expired" | "bad-signature" };

/**
 * Checks that `address` signed a link message naming `accountId`, recently. The account id is
 * the session's, passed in by the route; the one inside the message is only compared against
 * it, never trusted.
 */
export async function verifyLinkProof(input: {
  accountId: string;
  address: string;
  message: string;
  signature: string;
  now?: Date;
}): Promise<LinkProofResult> {
  const parsed = parseLinkMessage(input.message);
  if (!parsed) return { ok: false, reason: "malformed" };
  if (parsed.accountId !== input.accountId) return { ok: false, reason: "wrong-account" };

  const age = (input.now ?? new Date()).getTime() - parsed.issuedAt.getTime();
  // A little future skew is a client clock, not an attack; a lot is either.
  if (age > LINK_MESSAGE_MAX_AGE_MS || age < -60_000) return { ok: false, reason: "expired" };

  let signer: Address;
  let signature: Uint8Array;
  try {
    signer = toAddress(input.address);
    signature = new Uint8Array(getBase64Encoder().encode(input.signature));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (signature.length !== 64) return { ok: false, reason: "malformed" };

  const key = await getPublicKeyFromAddress(signer);
  const valid = await verifySignature(
    key,
    signature as SignatureBytes,
    new TextEncoder().encode(input.message),
  );
  return valid ? { ok: true, address: signer } : { ok: false, reason: "bad-signature" };
}
