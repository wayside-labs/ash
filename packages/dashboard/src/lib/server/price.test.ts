import { afterEach, describe, expect, it, vi } from "vitest";

describe("getSolUsdPrice", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("uses Coinbase spot when CoinGecko is blocked and product stats are gone", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("coingecko")) {
        return new Response("blocked", { status: 403 });
      }
      if (url.endsWith("/spot")) {
        return Response.json({ data: { amount: "123.45", base: "SOL", currency: "USD" } });
      }
      if (url.endsWith("/stats")) {
        return new Response("not found", { status: 404 });
      }
      throw new Error(`unexpected url ${url}`);
    });
    vi.stubGlobal("fetch", fetchImpl);

    const { getSolUsdPrice } = await import("./price");
    const price = await getSolUsdPrice();
    expect(price).toMatchObject({ usd: 123.45, source: "coinbase", change24h: null });
  });

  it("derives the 24h change from Coinbase Exchange stats", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("coingecko")) return new Response("blocked", { status: 403 });
        if (url.endsWith("/spot")) return Response.json({ data: { amount: "110" } });
        if (url === "https://api.exchange.coinbase.com/products/SOL-USD/stats") {
          return Response.json({ open: "100", last: "110" });
        }
        throw new Error(`unexpected url ${url}`);
      }),
    );

    const { getSolUsdPrice } = await import("./price");
    const price = await getSolUsdPrice();
    expect(price).toMatchObject({ usd: 110, source: "coinbase" });
    expect(price?.change24h).toBeCloseTo(10);
  });

  it("prefers Jupiter, with its 24h change", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://lite-api.jup.ag/price/v3")) {
          return Response.json({
            So11111111111111111111111111111111111111112: { usdPrice: 119.2, priceChange24h: 0.39 },
          });
        }
        throw new Error(`unexpected url ${url}`);
      }),
    );

    const { getSolUsdPrice } = await import("./price");
    expect(await getSolUsdPrice()).toMatchObject({
      usd: 119.2,
      change24h: 0.39,
      source: "jupiter",
    });
  });

  it("falls back to Kraken when every other source refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.startsWith("https://api.kraken.com/")) {
          return Response.json({ error: [], result: { SOLUSD: { c: ["119.21000", "3.25"] } } });
        }
        return new Response("blocked", { status: 403 });
      }),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getSolUsdPrice } = await import("./price");
    expect(await getSolUsdPrice()).toMatchObject({
      usd: 119.21,
      change24h: null,
      source: "kraken",
    });
  });

  it("returns null and says why when every source refuses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("blocked", { status: 403 })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { getSolUsdPrice } = await import("./price");
    expect(await getSolUsdPrice()).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("fromJupiter: http 403"));
  });
});
