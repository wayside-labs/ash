import type { User, UserIdentity } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { resolveIdentity } from "./identity";

const ADDRESS = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function identity(
  provider: string,
  data: Record<string, unknown>,
  id = "11111111-1111-4111-8111-111111111111",
): UserIdentity {
  return {
    id,
    identity_id: id,
    user_id: "00000000-0000-4000-8000-000000000001",
    provider,
    identity_data: data,
    created_at: "2026-09-24T00:00:00Z",
    last_sign_in_at: "2026-09-24T00:00:00Z",
    updated_at: "2026-09-24T00:00:00Z",
  };
}

function user(patch: Partial<User>): User {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-09-24T00:00:00Z",
    ...patch,
  } as User;
}

describe("resolveIdentity — google", () => {
  it("keys on the Google sub, not on the auth user id", () => {
    const resolved = resolveIdentity(
      user({
        email: "someone@example.com",
        user_metadata: { full_name: "Someone" },
        identities: [identity("google", { sub: "1078" })],
      }),
    );
    expect(resolved).toEqual({
      provider: "google",
      subject: "1078",
      displayName: "Someone",
      email: "someone@example.com",
    });
  });

  it("falls back to the email local part when Google sends no name", () => {
    const resolved = resolveIdentity(
      user({
        email: "someone@example.com",
        identities: [identity("google", { sub: "1078" })],
      }),
    );
    expect(resolved.displayName).toBe("someone");
  });
});

describe("resolveIdentity — wallet", () => {
  // Supabase has shipped the address in more than one place; each of these is a
  // shape the resolver has to survive, because picking wrong writes an identity
  // row that strands the user on their next sign-in.
  const shapes: [string, Partial<User>][] = [
    [
      "identity_data.address",
      {
        identities: [identity("web3", { address: ADDRESS })],
      },
    ],
    [
      "provider named solana",
      {
        identities: [identity("solana", { address: ADDRESS })],
      },
    ],
    [
      "user_metadata.address",
      {
        user_metadata: { address: ADDRESS },
        identities: [identity("web3", {})],
      },
    ],
    [
      "user_metadata.custom_claims.address",
      {
        user_metadata: { custom_claims: { address: ADDRESS } },
        identities: [identity("web3", {})],
      },
    ],
  ];

  for (const [name, patch] of shapes) {
    it(`reads the address from ${name}`, () => {
      const resolved = resolveIdentity(user(patch));
      expect(resolved.provider).toBe("wallet");
      expect(resolved.subject).toBe(ADDRESS);
    });
  }

  it("names the account after the address, since there is no email", () => {
    const resolved = resolveIdentity(
      user({
        identities: [identity("web3", { address: ADDRESS })],
      }),
    );
    expect(resolved.displayName).toBe("7xKX…gAsU");
    expect(resolved.email).toBe("");
  });

  it("throws instead of accepting a uuid as an address", () => {
    expect(() =>
      resolveIdentity(
        user({
          identities: [identity("web3", {}, "0e2d9f3a-1b4c-4d5e-8f60-112233445566")],
        }),
      ),
    ).toThrow(/no wallet address/);
  });
});

/**
 * Captured from a real `POST /auth/v1/token?grant_type=web3` against the hosted
 * project on 2026-09-24, not written from the docs. The address lives under
 * `custom_claims` and `identity.id` reads `web3:solana:<address>` -- a resolver
 * that took the id would key the account on a string that is not an address.
 */
describe("resolveIdentity — the shape GoTrue actually returns", () => {
  const LIVE = user({
    id: "2713f5df-6dd6-4f70-885f-d175d8981217",
    email: "",
    app_metadata: { provider: "web3", providers: ["web3"] },
    user_metadata: {
      custom_claims: {
        address: ADDRESS,
        chain: "solana",
        domain: "agent-rails-virid.vercel.app",
        network: "",
        statement: "Sign in to Agent Rails.",
      },
      email_verified: false,
      phone_verified: false,
      sub: `web3:solana:${ADDRESS}`,
    },
    identities: [
      identity(
        "web3",
        {
          custom_claims: { address: ADDRESS, chain: "solana" },
          email_verified: false,
          sub: `web3:solana:${ADDRESS}`,
        },
        `web3:solana:${ADDRESS}`,
      ),
    ],
  });

  it("keys the identity on the address, not on `web3:solana:…`", () => {
    expect(resolveIdentity(LIVE)).toEqual({
      provider: "wallet",
      subject: ADDRESS,
      displayName: "7xKX…gAsU",
      email: "",
    });
  });

  it("an empty email string does not become the display name", () => {
    expect(resolveIdentity(LIVE).displayName).not.toBe("");
  });
});

describe("resolveIdentity — neither", () => {
  it("refuses a provider it does not model", () => {
    expect(() =>
      resolveIdentity(
        user({
          app_metadata: { provider: "github" },
          identities: [identity("github", {})],
        }),
      ),
    ).toThrow(/unsupported sign-in provider: github/);
  });
});

describe("google wins when an account has both", () => {
  it("prefers the Google identity so the subject stays stable", () => {
    const resolved = resolveIdentity(
      user({
        email: "someone@example.com",
        identities: [identity("web3", { address: ADDRESS }), identity("google", { sub: "1078" })],
      }),
    );
    expect(resolved).toMatchObject({ provider: "google", subject: "1078" });
  });
});

describe("resolveIdentity — email magic link", () => {
  it("keys on the auth user id, so a changed address keeps the same account", () => {
    const resolved = resolveIdentity(
      user({
        email: "someone@example.com",
        identities: [identity("email", { sub: "00000000-0000-4000-8000-000000000001" })],
      }),
    );
    expect(resolved).toEqual({
      provider: "email",
      subject: "00000000-0000-4000-8000-000000000001",
      displayName: "someone",
      email: "someone@example.com",
    });
  });

  it("prefers Google when GoTrue linked both doors to one user", () => {
    const resolved = resolveIdentity(
      user({
        email: "someone@example.com",
        identities: [identity("email", { sub: "u-1" }), identity("google", { sub: "1078" })],
      }),
    );
    expect(resolved.provider).toBe("google");
    expect(resolved.subject).toBe("1078");
  });
});
