import { mkdtemp } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_RAILS_PROGRAM_ADDRESS } from "@agent-rails/client";
import { deriveIntentId } from "@agent-rails/contract";
import { findReceiptPda } from "@agent-rails/sdk";
import { type Address, address } from "@solana/kit";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadVendorConfig, type VendorId } from "./config.js";
import { createVendorServer } from "./server.js";
import { VENDORS } from "./vendors/index.js";
import { resetOracleCache } from "./vendors/oracle.js";
import type { ReceiptReader } from "./verify.js";

const PAY_TO = "3tvQknH6RHfnssAGgC64z7KkejwrQ3USftxosmoimX4z";
const SESSION = "H4HU1sPoevCGqHeFQiyW5Q8NVmQgAb1DyZgP2LSzwMPE";
const OTHER_SESSION = "BTE45zKpHiWMTwaPmShaUBq2cnA6XUc8KhgxnufSnz3w";
const NATIVE = "So11111111111111111111111111111111111111112";

type FakeReceipt = { amount: bigint; owner?: Address; destination?: string };

/** Stands in for the chain: receipts exist only once a test "pays". */
class FakeChain {
  receipts = new Map<string, FakeReceipt & { session: string }>();

  async pay(session: string, reference: string, amount: bigint, extra: Partial<FakeReceipt> = {}) {
    const intentId = deriveIntentId({
      session,
      destination: PAY_TO,
      mint: NATIVE,
      amount: extra.amount ?? amount,
      reference,
    });
    const [pda] = await findReceiptPda({ session: address(session), intentId });
    this.receipts.set(pda, { session, amount, ...extra });
  }

  reader: ReceiptReader = async (receipt) => {
    const row = this.receipts.get(receipt);
    if (!row) return { exists: false, address: receipt } as never;
    return {
      exists: true,
      address: receipt,
      programAddress: row.owner ?? AGENT_RAILS_PROGRAM_ADDRESS,
      data: {
        status: 1,
        session: row.session,
        destinationOwner: row.destination ?? PAY_TO,
        mint: NATIVE,
        amount: row.amount,
        seq: 7n,
        slot: 100n,
      },
    } as never;
  };
}

let chain: FakeChain;
let base: string;
let close: () => void;

async function start(vendor: VendorId) {
  const dir = await mkdtemp(join(tmpdir(), "vendor-test-"));
  const config = loadVendorConfig(vendor, {
    [`${vendor.toUpperCase()}_PAY_TO`]: PAY_TO,
    VENDOR_DATA_DIR: dir,
    ORACLE_SOURCE: "mock",
  });
  const { server } = await createVendorServer({
    config,
    module: VENDORS[vendor],
    readReceipt: chain.reader,
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
}

async function call(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  // biome-ignore lint/suspicious/noExplicitAny: test assertions walk arbitrary JSON
  return { status: res.status, body: (await res.json()) as any };
}

beforeEach(() => {
  process.env.ORACLE_SOURCE = "mock";
  chain = new FakeChain();
});
afterEach(() => close());

describe("invoice → pay → redeem", () => {
  beforeEach(() => start("oracle"));

  it("prices per unit and hands back everything the rails payment needs", async () => {
    const { status, body } = await call("POST", "/invoices", { symbols: ["sol", "BTC", "SOL"] });
    expect(status).toBe(201);
    expect(body.units).toBe(2);
    expect(body.payment).toMatchObject({
      destination_label: "vendor-oracle",
      destination_owner: PAY_TO,
      amount: "0.0002",
      amount_base_units: "200000",
      mint_ref: "SOL",
      reference: body.invoice_id,
    });
  });

  it("refuses to deliver until the receipt exists, then delivers once and replays", async () => {
    const { body: inv } = await call("POST", "/invoices", { symbols: ["SOL"] });
    const early = await call("POST", `/invoices/${inv.invoice_id}/redeem`, { session: SESSION });
    expect(early.status).toBe(402);
    expect(early.body.payment_error.code).toBe("RECEIPT_NOT_FOUND");

    await chain.pay(SESSION, inv.invoice_id, 100_000n);
    const ok = await call("POST", `/invoices/${inv.invoice_id}/redeem`, { session: SESSION });
    expect(ok.status).toBe(200);
    expect(ok.body.delivery.source).toBe("mock");
    expect(ok.body.delivery.prices_usd.SOL).toBeGreaterThan(0);

    const again = await call("POST", `/invoices/${inv.invoice_id}/redeem`, { session: SESSION });
    expect(again.status).toBe(200);
    expect(again.body.replay).toBe(true);
    expect(again.body.delivery).toEqual(ok.body.delivery);

    await chain.pay(OTHER_SESSION, inv.invoice_id, 100_000n);
    const stolen = await call("POST", `/invoices/${inv.invoice_id}/redeem`, {
      session: OTHER_SESSION,
    });
    expect(stolen.status).toBe(409);
  });

  it("does not accept a payment that settles a different invoice", async () => {
    const { body: a } = await call("POST", "/invoices", { symbols: ["SOL"] });
    const { body: b } = await call("POST", "/invoices", { symbols: ["SOL"] });
    await chain.pay(SESSION, a.invoice_id, 100_000n);
    const res = await call("POST", `/invoices/${b.invoice_id}/redeem`, { session: SESSION });
    expect(res.status).toBe(402);
  });

  it("rejects an underpaying, misdirected or foreign receipt at the right address", async () => {
    const cases: Partial<FakeReceipt>[] = [
      { amount: 99_999n },
      { destination: OTHER_SESSION },
      { owner: address(PAY_TO) },
    ];
    for (const extra of cases) {
      const { body: inv } = await call("POST", "/invoices", { symbols: ["SOL"] });
      // Receipt sits at the PDA derived from the invoiced amount; its fields lie.
      await chain.pay(SESSION, inv.invoice_id, 100_000n, { ...extra, amount: 100_000n });
      const pda = [...chain.receipts.keys()].at(-1) as string;
      const row = chain.receipts.get(pda);
      if (row) Object.assign(row, extra);
      const res = await call("POST", `/invoices/${inv.invoice_id}/redeem`, { session: SESSION });
      expect(res.status).toBe(402);
      expect(["RECEIPT_MISMATCH", "RECEIPT_FOREIGN_OWNER"]).toContain(res.body.payment_error.code);
    }
  });

  it("explains a claimed intent id that belongs to some other payment", async () => {
    const { body: inv } = await call("POST", "/invoices", { symbols: ["SOL"] });
    const res = await call("POST", `/invoices/${inv.invoice_id}/redeem`, {
      session: SESSION,
      intent_id: "0".repeat(32),
    });
    expect(res.status).toBe(402);
    expect(res.body.payment_error.code).toBe("INTENT_MISMATCH");
  });

  it("keeps a pinned invoice for the session that asked for it", async () => {
    const { body: inv } = await call("POST", "/invoices", { symbols: ["SOL"], session: SESSION });
    await chain.pay(OTHER_SESSION, inv.invoice_id, 100_000n);
    const res = await call("POST", `/invoices/${inv.invoice_id}/redeem`, {
      session: OTHER_SESSION,
    });
    expect(res.status).toBe(403);
  });

  it("validates purchase requests", async () => {
    expect((await call("POST", "/invoices", { symbols: ["DOGE"] })).status).toBe(422);
    expect((await call("POST", "/invoices", { symbols: [] })).status).toBe(422);
    expect((await call("GET", "/invoices/inv_oracle_nope")).status).toBe(404);
    expect((await call("POST", "/invoices/inv_oracle_nope/redeem", {})).status).toBe(404);
  });
});

describe("notary", () => {
  beforeEach(() => start("notary"));
  const hash = "a".repeat(64);

  it("sells a hash once and gives it away afterwards", async () => {
    expect((await call("GET", `/certificates/${hash}`)).status).toBe(404);
    const { body: inv } = await call("POST", "/invoices", { sha256: hash, label: "doc" });
    await chain.pay(SESSION, inv.invoice_id, 500_000n);
    const res = await call("POST", `/invoices/${inv.invoice_id}/redeem`, { session: SESSION });
    expect(res.status).toBe(200);
    expect(res.body.delivery.certificate).toMatchObject({ sha256: hash, payer_session: SESSION });

    const lookup = await call("GET", `/certificates/${hash.toUpperCase()}`);
    expect(lookup.status).toBe(200);
    const again = await call("POST", "/invoices", { sha256: hash });
    expect(again.status).toBe(200);
    expect(again.body.already_notarized).toBe(true);
  });
});

describe("compute", () => {
  beforeEach(() => start("compute"));

  it("buys credits, spends them on jobs and refuses when they run out", async () => {
    const { body: inv } = await call("POST", "/invoices", { packs: 1 });
    expect(inv.payment.amount).toBe("0.001");
    await chain.pay(SESSION, inv.invoice_id, 1_000_000n);
    const res = await call("POST", `/invoices/${inv.invoice_id}/redeem`, { session: SESSION });
    const { token, account_id, balance } = res.body.delivery;
    expect(balance).toBe(10);

    expect((await call("POST", "/jobs", { kind: "sha256", input: "x" })).status).toBe(401);
    const job = await call("POST", "/jobs", { kind: "keywords", input: "rails rails pay" }, token);
    expect(job.status).toBe(200);
    expect(job.body.result.keywords[0]).toEqual({ term: "rails", count: 2 });
    for (let i = 0; i < 4; i++) {
      await call("POST", "/jobs", { kind: "summarize", input: "One. Two." }, token);
    }
    expect((await call("GET", "/account", undefined, token)).body.balance).toBe(1);
    const broke = await call("POST", "/jobs", { kind: "summarize", input: "x." }, token);
    expect(broke.status).toBe(402);

    const { body: topUp } = await call("POST", "/invoices", { packs: 2, account_id });
    await chain.pay(SESSION, topUp.invoice_id, 2_000_000n);
    const res2 = await call("POST", `/invoices/${topUp.invoice_id}/redeem`, { session: SESSION });
    expect(res2.body.delivery).toMatchObject({ account_id, balance: 21 });
    expect(res2.body.delivery.token).toBeUndefined();
  });
});

describe("oracle outside mock mode", () => {
  const realFetch = globalThis.fetch;
  let upstreamUp = true;

  beforeEach(async () => {
    upstreamUp = true;
    resetOracleCache();
    vi.stubGlobal("fetch", (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).startsWith("https://api.coingecko.com")) {
        return upstreamUp
          ? Promise.resolve(Response.json({ solana: { usd: 123.45 }, bitcoin: { usd: 1 } }))
          : Promise.reject(new Error("offline"));
      }
      return realFetch(input, init);
    });
    await start("oracle");
    process.env.ORACLE_SOURCE = "live";
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.ORACLE_SOURCE = "mock";
  });

  it("invoices nothing while the upstream is down", async () => {
    upstreamUp = false;
    const res = await call("POST", "/invoices", { symbols: ["SOL"] });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/nothing was invoiced/);
  });

  it("keeps a paid invoice open when delivery fails, then delivers the real price", async () => {
    const { body: inv } = await call("POST", "/invoices", { symbols: ["SOL"] });
    expect(inv.invoice_id).toBeDefined();
    await chain.pay(SESSION, inv.invoice_id, 100_000n);

    upstreamUp = false;
    resetOracleCache();
    const down = await call("POST", `/invoices/${inv.invoice_id}/redeem`, { session: SESSION });
    expect(down.status).toBe(503);
    expect(down.body).toMatchObject({ paid: true, retryable: true, status: "open" });

    upstreamUp = true;
    const up = await call("POST", `/invoices/${inv.invoice_id}/redeem`, { session: SESSION });
    expect(up.status).toBe(200);
    expect(up.body.delivery).toMatchObject({ source: "coingecko", prices_usd: { SOL: 123.45 } });
  });
});
