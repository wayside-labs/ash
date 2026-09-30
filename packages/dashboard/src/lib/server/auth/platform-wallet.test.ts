import { generateKeyPair, getAddressFromPublicKey, getBase64Decoder, signBytes } from "@solana/kit";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import type { PlatformWalletProvider } from "@/lib/server/wallet-provider";
import { platformWalletProvider, stubWalletProvider } from "@/lib/server/wallet-provider";
import { linkMessage } from "@/lib/wallet-link";
import { ensurePlatformWallet, verifyLinkProof } from "./platform-wallet";

const ACCOUNT = "3f0c6a8e-0000-4000-8000-000000000001";
const NOW = new Date("2026-10-01T12:00:00.000Z");

async function signer() {
  const keys = await generateKeyPair();
  const address = await getAddressFromPublicKey(keys.publicKey);
  const sign = async (message: string) =>
    getBase64Decoder().decode(await signBytes(keys.privateKey, new TextEncoder().encode(message)));
  return { address, sign };
}

describe("verifyLinkProof", () => {
  it("accepts a fresh signature over this account's statement", async () => {
    const { address, sign } = await signer();
    const message = linkMessage(ACCOUNT, NOW);
    const result = await verifyLinkProof({
      accountId: ACCOUNT,
      address,
      message,
      signature: await sign(message),
      now: NOW,
    });
    expect(result).toEqual({ ok: true, address });
  });

  it("refuses a statement naming another account, even when validly signed", async () => {
    const { address, sign } = await signer();
    const message = linkMessage("someone-else", NOW);
    const result = await verifyLinkProof({
      accountId: ACCOUNT,
      address,
      message,
      signature: await sign(message),
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "wrong-account" });
  });

  it("refuses a signature by a different key than the address claims", async () => {
    const victim = await signer();
    const attacker = await signer();
    const message = linkMessage(ACCOUNT, NOW);
    const result = await verifyLinkProof({
      accountId: ACCOUNT,
      address: victim.address,
      message,
      signature: await attacker.sign(message),
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("refuses a stale statement", async () => {
    const { address, sign } = await signer();
    const message = linkMessage(ACCOUNT, new Date(NOW.getTime() - 6 * 60_000));
    const result = await verifyLinkProof({
      accountId: ACCOUNT,
      address,
      message,
      signature: await sign(message),
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("refuses a malformed address or signature without throwing", async () => {
    const message = linkMessage(ACCOUNT, NOW);
    expect(
      await verifyLinkProof({
        accountId: ACCOUNT,
        address: "not-an-address",
        message,
        signature: "AAAA",
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: "malformed" });
    const { address } = await signer();
    expect(
      await verifyLinkProof({ accountId: ACCOUNT, address, message, signature: "AAAA", now: NOW }),
    ).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("wallet providers", () => {
  it("the stub hands out a real address and admits no one holds its key", async () => {
    const wallet = await stubWalletProvider.provision({ accountId: ACCOUNT });
    expect(wallet.publicKey).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(wallet.custody).toBe("none");
    expect(JSON.stringify(wallet)).not.toMatch(/private|secret/i);
  });

  it("defaults to the stub and refuses a name it does not know", () => {
    expect(platformWalletProvider(undefined).id).toBe("stub");
    expect(() => platformWalletProvider("privvy")).toThrow(/unknown PLATFORM_WALLET_PROVIDER/);
  });
});

/** Just enough of the query builder for platform_wallets: select-by-account and insert. */
function fakeAdmin(initial: Record<string, unknown> | null, insertError: unknown = null) {
  let row = initial;
  const inserted: unknown[] = [];
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }),
      }),
      insert: async (values: Record<string, unknown>) => {
        inserted.push(values);
        if (!insertError) row = { ...values, created_at: "2026-10-01T12:00:00Z" };
        return { error: insertError };
      },
    }),
  };
  return {
    client: client as unknown as SupabaseClient,
    inserted,
    setRow: (next: Record<string, unknown>) => {
      row = next;
    },
  };
}

function provider(): PlatformWalletProvider & { provision: ReturnType<typeof vi.fn> } {
  return {
    id: "test",
    custody: "provider",
    provision: vi.fn().mockResolvedValue({
      publicKey: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      provider: "test",
      providerWalletId: "w-1",
      custody: "provider",
      metadata: {},
    }),
  };
}

describe("ensurePlatformWallet", () => {
  it("provisions once and records the pubkey with its provider", async () => {
    const admin = fakeAdmin(null);
    const p = provider();
    const wallet = await ensurePlatformWallet(admin.client, ACCOUNT, p);
    expect(wallet).toMatchObject({
      publicKey: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      provider: "test",
      custody: "provider",
    });
    expect(admin.inserted).toEqual([
      expect.objectContaining({ account_id: ACCOUNT, provider_wallet_id: "w-1" }),
    ]);
  });

  it("does not provision again for an account that has a wallet", async () => {
    const admin = fakeAdmin({
      public_key: "existing",
      provider: "stub",
      custody: "none",
      created_at: "2026-09-01T00:00:00Z",
    });
    const p = provider();
    const wallet = await ensurePlatformWallet(admin.client, ACCOUNT, p);
    expect(wallet.publicKey).toBe("existing");
    expect(p.provision).not.toHaveBeenCalled();
  });

  it("returns the winner's row when a concurrent sign-in inserted first", async () => {
    const admin = fakeAdmin(null, { code: "23505" });
    const p = provider();
    p.provision.mockImplementation(async () => {
      admin.setRow({
        public_key: "winner",
        provider: "test",
        custody: "provider",
        created_at: "2026-10-01T12:00:00Z",
      });
      return {
        publicKey: "loser",
        provider: "test",
        providerWalletId: null,
        custody: "provider",
        metadata: {},
      };
    });
    const wallet = await ensurePlatformWallet(admin.client, ACCOUNT, p);
    expect(wallet.publicKey).toBe("winner");
  });

  it("surfaces any other insert failure", async () => {
    const admin = fakeAdmin(null, { code: "42501", message: "permission denied" });
    await expect(ensurePlatformWallet(admin.client, ACCOUNT, provider())).rejects.toMatchObject({
      code: "42501",
    });
  });
});
