/**
 * Spot SOL/USD for the dashboard. Pyth Hermes now 401s without a key, so this
 * reads a public index (CoinGecko) and falls back to Coinbase rather than
 * asking the owner to mint an oracle credential for a ticker.
 *
 * Cached in-process so a page with several money widgets does not fan out.
 */

export type SolPrice = {
  usd: number;
  /** Percent change over the last 24 hours, when the source exposes it. */
  change24h: number | null;
  source: "coingecko" | "coinbase";
  asOf: string;
};

const CACHE_MS = 8_000;
const FETCH_MS = 4_000;

type CacheEntry = { at: number; value: SolPrice };

let cache: CacheEntry | null = null;
let inflight: Promise<SolPrice | null> | null = null;

function parsePositiveUsd(value: unknown): number | null {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseChangePct(value: unknown): number | null {
  const n =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return n;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(FETCH_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`http ${res.status}`);
  return res.json();
}

async function fromCoinGecko(): Promise<SolPrice> {
  const body = (await fetchJson(
    "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd&include_24hr_change=true",
  )) as { solana?: { usd?: unknown; usd_24h_change?: unknown } };
  const usd = parsePositiveUsd(body.solana?.usd);
  if (usd === null) throw new Error("coingecko");
  return {
    usd,
    change24h: parseChangePct(body.solana?.usd_24h_change),
    source: "coingecko",
    asOf: new Date().toISOString(),
  };
}

async function fromCoinbase(): Promise<SolPrice> {
  // Stats live on the Exchange host, not api.coinbase.com/v2 (404 there), and are
  // nice-to-have: a failed stats read must never cost the spot price. Fetched in
  // parallel so a slow stats host does not delay the ticker.
  const [spot, stats] = await Promise.allSettled([
    fetchJson("https://api.coinbase.com/v2/prices/SOL-USD/spot"),
    fetchJson("https://api.exchange.coinbase.com/products/SOL-USD/stats"),
  ]);
  if (spot.status === "rejected") throw spot.reason;
  const spotBody = spot.value as { data?: { amount?: unknown } };
  const usd = parsePositiveUsd(spotBody.data?.amount);
  if (usd === null) throw new Error("coinbase");

  let change24h: number | null = null;
  if (stats.status === "fulfilled") {
    const statsBody = stats.value as { open?: unknown; last?: unknown };
    const open = parsePositiveUsd(statsBody.open);
    const last = parsePositiveUsd(statsBody.last) ?? usd;
    change24h = open === null ? null : ((last - open) / open) * 100;
  }

  return { usd, change24h, source: "coinbase", asOf: new Date().toISOString() };
}

export async function getSolUsdPrice(): Promise<SolPrice | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (inflight) return inflight;

  inflight = (async () => {
    for (const read of [fromCoinGecko, fromCoinbase]) {
      try {
        const value = await read();
        cache = { at: Date.now(), value };
        return value;
      } catch {}
    }
    return cache?.value ?? null;
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}
