import { generateKeyPair, getAddressFromPublicKey, getBase64Decoder, signBytes } from "@solana/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { linkMessage } from "@/lib/wallet-link";

const ACCOUNT = "3f0c6a8e-0000-4000-8000-000000000001";
const HEADERS = {
  origin: "http://localhost:3000",
  host: "localhost:3000",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

const resolvePostgresContext = vi.fn();
const upsert = vi.fn();
let plan: "free" | "pro" = "free";

vi.mock("@/lib/server/state/context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/state/context")>();
  return {
    ...actual,
    resolvePostgresContext,
    requirePostgresContext: async () => {
      const result = await resolvePostgresContext();
      if (result?.kind === "ok") return result.ctx;
      throw new actual.StateAccessError(actual.unauthorizedStateResponse());
    },
  };
});
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: () => ({ upsert }) }),
}));

/** Answers the three account-scoped reads `readAccountWallet` makes. */
function sessionClient() {
  const rows: Record<string, unknown> = {
    account_entitlements: plan === "pro" ? { plan: "pro" } : null,
    platform_wallets: {
      public_key: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      provider: "stub",
      custody: "none",
      created_at: "2026-10-01T00:00:00Z",
    },
  };
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
          order: async () => ({ data: [], error: null }),
        }),
      }),
    }),
  };
}

const { GET } = await import("./route");
const { POST } = await import("./link/route");

async function signedLink(accountId = ACCOUNT) {
  const keys = await generateKeyPair();
  const address = await getAddressFromPublicKey(keys.publicKey);
  const message = linkMessage(accountId, new Date());
  const signature = getBase64Decoder().decode(
    await signBytes(keys.privateKey, new TextEncoder().encode(message)),
  );
  return { address, message, signature, walletName: "Phantom" };
}

function link(body: unknown) {
  return POST(
    new Request("http://localhost:3000/api/account/wallet/link", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
    }),
  );
}

describe("account wallet routes", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    plan = "free";
    upsert.mockReset().mockResolvedValue({ error: null });
    resolvePostgresContext.mockReset().mockImplementation(async () => ({
      kind: "ok",
      ctx: { supabase: sessionClient(), accountId: ACCOUNT, orgId: "org-1" },
    }));
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.DASHBOARD_EXTERNAL_WALLETS;
  });

  it("GET answers 401 to a visitor with no session", async () => {
    resolvePostgresContext.mockResolvedValue({ kind: "anonymous" });
    expect((await GET()).status).toBe(401);
  });

  it("GET shows a free account its platform wallet and a closed gate", async () => {
    const body = await (await GET()).json();
    expect(body).toMatchObject({
      hosted: true,
      accountId: ACCOUNT,
      plan: "free",
      externalWallets: false,
      platformWallet: {
        publicKey: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
        custody: "none",
      },
    });
  });

  it("GET in local mode opens the gate and has no platform wallet", async () => {
    resolvePostgresContext.mockResolvedValue(null);
    const body = await (await GET()).json();
    expect(body).toMatchObject({ hosted: false, externalWallets: true, platformWallet: null });
  });

  it("POST link refuses a free account before looking at the signature", async () => {
    const res = await link(await signedLink());
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("POST link records a Pro account's proven wallet", async () => {
    plan = "pro";
    const proof = await signedLink();
    const res = await link(proof);
    expect(res.status).toBe(200);
    expect(upsert).toHaveBeenCalledWith(
      { account_id: ACCOUNT, address: proof.address, wallet_name: "Phantom" },
      expect.anything(),
    );
  });

  it("POST link opens for a free account when the deployment says everyone", async () => {
    process.env.DASHBOARD_EXTERNAL_WALLETS = "everyone";
    expect((await link(await signedLink())).status).toBe(200);
  });

  it("POST link refuses a proof signed for another account", async () => {
    plan = "pro";
    const res = await link(await signedLink("another-account"));
    expect(res.status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("POST link refuses a cross-site request", async () => {
    plan = "pro";
    const res = await POST(
      new Request("http://localhost:3000/api/account/wallet/link", {
        method: "POST",
        headers: { ...HEADERS, origin: "https://evil.example", "sec-fetch-site": "cross-site" },
        body: JSON.stringify(await signedLink()),
      }),
    );
    expect(res.status).toBe(403);
    expect(upsert).not.toHaveBeenCalled();
  });
});
