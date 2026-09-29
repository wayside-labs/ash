import { describe, expect, it, vi } from "vitest";
import { POST as buildStep } from "./build-step/route";
import { POST as plan } from "./plan/route";
import { GET as vendors } from "./vendors/route";

const HEADERS = {
  origin: "http://localhost:3000",
  host: "localhost:3000",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

vi.mock("@/lib/server/bootstrap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/bootstrap")>();
  return {
    ...actual,
    planTreasuryBootstrap: vi.fn(),
    buildTreasuryBootstrapStep: vi.fn(),
  };
});

vi.mock("@/lib/server/vendors", () => ({ fetchVendorPresets: vi.fn() }));

import { buildTreasuryBootstrapStep, planTreasuryBootstrap } from "@/lib/server/bootstrap";
import { SolanaRequestError } from "@/lib/server/solana";
import { fetchVendorPresets } from "@/lib/server/vendors";

const WALLET = "5LwWtPdEvVUSbYCTv5zvhP9gkt3nKANLGkvD2xa6jvvD";
const CREATE_KEY = "7v5FqEj8DaCbvJPEqpUtZXKyLBtrHuxhG2tWayTaJd4C";
const TREASURY = "2xbbqA1KvP7znHHk59tCbyN85cyHTy5hcwpQnwTKGc1i";

const BODY = {
  cluster: "devnet",
  rpc: null,
  wallet: WALLET,
  treasury: null,
  createKey: CREATE_KEY,
  policyName: "default",
  perTxLamports: "100000000",
  dailyLamports: "1000000000",
  depositLamports: "500000000",
};

const post = (handler: (req: Request) => Promise<Response>, body: unknown, headers = HEADERS) =>
  handler(
    new Request("http://localhost:3000/api/solana/bootstrap", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    }),
  );

describe("POST /api/solana/bootstrap/plan", () => {
  it("refuses a cross-site request before reading the body", async () => {
    const res = await post(plan, BODY, {
      ...HEADERS,
      origin: "https://evil.example",
      "sec-fetch-site": "cross-site",
    });
    expect(res.status).toBe(403);
    expect(planTreasuryBootstrap).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload", async () => {
    expect((await post(plan, {})).status).toBe(422);
  });

  it("rejects lamports that are not a decimal string", async () => {
    expect((await post(plan, { ...BODY, perTxLamports: 0.1 })).status).toBe(422);
  });

  it("rejects a policy name longer than the program's 32 bytes", async () => {
    expect((await post(plan, { ...BODY, policyName: "é".repeat(17) })).status).toBe(422);
  });

  it("converts amounts to bigint and fills the optional parts with null", async () => {
    vi.mocked(planTreasuryBootstrap).mockResolvedValueOnce({
      treasury: TREASURY,
      solVault: TREASURY,
      policy: TREASURY,
      session: null,
      allowlistEntry: null,
      treasuryExists: false,
      steps: [{ id: "treasury", instructions: 2 }],
      deposit: { target: "500000000", held: "0", shortfall: "500000000" },
      feeBudget: null,
      walletLamports: "0",
      requiredLamports: "505000000",
    });

    const res = await post(plan, BODY);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ treasury: TREASURY });
    expect(planTreasuryBootstrap).toHaveBeenCalledWith(
      "devnet",
      null,
      expect.objectContaining({
        perTxLamports: 100_000_000n,
        lifetimeLamports: null,
        destination: null,
        session: null,
      }),
    );
  });

  it("maps SolanaRequestError to a translated 400", async () => {
    vi.mocked(planTreasuryBootstrap).mockRejectedValueOnce(
      new SolanaRequestError("api.error.policyAboveCeiling"),
    );
    const res = await post(plan, BODY);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).not.toBe("api.error.policyAboveCeiling");
    expect(body.error.length).toBeGreaterThan(0);
  });
});

describe("POST /api/solana/bootstrap/build-step", () => {
  it("returns the next unsigned stage", async () => {
    vi.mocked(buildTreasuryBootstrapStep).mockResolvedValueOnce({
      done: false,
      treasury: TREASURY,
      stepId: "treasury",
      transaction: "AQID",
      lastValidBlockHeight: 42,
      needsCreateKeySignature: true,
      remaining: 3,
    });
    const res = await post(buildStep, {
      ...BODY,
      destination: { owner: TREASURY, label: "oracle" },
      session: { key: TREASURY, label: "agent", feeBudgetLamports: "50000000" },
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ stepId: "treasury", transaction: "AQID" });
    expect(buildTreasuryBootstrapStep).toHaveBeenLastCalledWith(
      "devnet",
      null,
      expect.objectContaining({
        session: { key: TREASURY, label: "agent", ttlHours: 24, feeBudgetLamports: 50_000_000n },
      }),
    );
  });

  it("reports an RPC failure as a 502", async () => {
    vi.mocked(buildTreasuryBootstrapStep).mockRejectedValueOnce(new Error("rpc down"));
    const res = await post(buildStep, BODY);
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "rpc down" });
  });
});

describe("GET /api/solana/bootstrap/vendors", () => {
  it("returns whatever the catalogs yielded", async () => {
    vi.mocked(fetchVendorPresets).mockResolvedValueOnce([
      { vendor: "oracle", title: "Oracle", label: "oracle", owner: WALLET, mintRef: "SOL" },
    ]);
    const res = await vendors();
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      vendors: [
        { vendor: "oracle", title: "Oracle", label: "oracle", owner: WALLET, mintRef: "SOL" },
      ],
    });
  });
});
