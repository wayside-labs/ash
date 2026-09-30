import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> | null;
let user: { id: string } | null;
let rows: Record<string, Row>;

function query(table: string) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
  };
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: query,
  }),
}));

const { requirePostgresContext, StateAccessError } = await import("./context");

async function denial(): Promise<{ status: number; body: unknown }> {
  try {
    await requirePostgresContext();
  } catch (error) {
    if (!(error instanceof StateAccessError)) throw error;
    return { status: error.response.status, body: await error.response.json() };
  }
  throw new Error("expected a denial");
}

describe("requirePostgresContext", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
    user = { id: "u1" };
    rows = { identities: { account_id: "a1" }, memberships: { org_id: "o1" } };
  });

  afterEach(() => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });

  it("answers 401 without a session", async () => {
    user = null;
    expect(await denial()).toEqual({ status: 401, body: { error: "unauthorized" } });
  });

  it("answers 403 for a session with no identity row", async () => {
    rows.identities = null;
    expect(await denial()).toEqual({ status: 403, body: { error: "account not provisioned" } });
  });

  it("answers 403 for an account with no membership", async () => {
    rows.memberships = null;
    expect(await denial()).toEqual({ status: 403, body: { error: "account not provisioned" } });
  });

  it("resolves the account and org", async () => {
    const ctx = await requirePostgresContext();
    expect(ctx.accountId).toBe("a1");
    expect(ctx.orgId).toBe("o1");
  });
});
