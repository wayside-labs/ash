import { z } from "zod";
import { nowSeconds } from "../store.js";
import { DeliveryUnavailable, type VendorModule } from "../vendor.js";

/** Symbol → CoinGecko id. Short on purpose: every entry is one more thing a test can assert. */
const SYMBOLS: Record<string, string> = {
  SOL: "solana",
  BTC: "bitcoin",
  ETH: "ethereum",
  USDC: "usd-coin",
  JUP: "jupiter-exchange-solana",
  BONK: "bonk",
};

/**
 * Fixed figures for `ORACLE_SOURCE=mock` only — local runs and offline tests, labelled
 * `source: "mock"` in every answer. Outside mock mode a failing upstream is a refusal, never
 * these numbers: someone who paid for a price must not receive an invented one.
 */
const MOCK_USD: Record<string, number> = {
  SOL: 150,
  BTC: 60_000,
  ETH: 3_000,
  USDC: 1,
  JUP: 0.8,
  BONK: 0.00002,
};

const mockMode = () => process.env.ORACLE_SOURCE === "mock";

const MAX_SYMBOLS = 10;
const CACHE_TTL_MS = 30_000;
/** A cached price older than this is not served, even when the upstream is down. */
const MAX_STALE_MS = 10 * 60_000;

const requestSchema = z.object({
  symbols: z.array(z.string().min(1).max(10)).min(1).max(MAX_SYMBOLS),
  session: z.string().optional(),
});

let cache: { at: number; prices: Record<string, number> } | null = null;

type Snapshot = { at: number; prices: Record<string, number> };

/** Last good snapshot, served while fresh or while the upstream fails but it is not too old. */
async function livePrices(): Promise<Snapshot | null> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache;
  const fallback = () => (cache && Date.now() - cache.at < MAX_STALE_MS ? cache : null);
  try {
    const ids = Object.values(SYMBOLS).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
      { signal: AbortSignal.timeout(5_000) },
    );
    if (!res.ok) return fallback();
    const json = (await res.json()) as Record<string, { usd?: number }>;
    const prices: Record<string, number> = {};
    for (const [symbol, id] of Object.entries(SYMBOLS)) {
      const usd = json[id]?.usd;
      if (typeof usd === "number") prices[symbol] = usd;
    }
    cache = { at: Date.now(), prices };
    return cache;
  } catch {
    return fallback();
  }
}

/** Test hook: forget the cached snapshot. */
export function resetOracleCache(): void {
  cache = null;
}

export const oracle: VendorModule<Record<string, never>> = {
  id: "oracle",
  title: "Rails Oracle — pay-per-quote price feed",
  unit: "one symbol in one quote",
  describe: () => ({ symbols: Object.keys(SYMBOLS), max_symbols_per_quote: MAX_SYMBOLS }),
  emptyState: () => ({}),
  quote: async (body) => {
    const parsed = requestSchema.safeParse(body);
    if (!parsed.success) {
      return { kind: "error", status: 422, message: `expected {symbols: [..${MAX_SYMBOLS}]}` };
    }
    const symbols = [...new Set(parsed.data.symbols.map((s) => s.trim().toUpperCase()))];
    const unknown = symbols.filter((s) => !Object.hasOwn(SYMBOLS, s));
    if (unknown.length > 0) {
      return {
        kind: "error",
        status: 422,
        message: `unknown symbols: ${unknown.join(", ")}; supported: ${Object.keys(SYMBOLS).join(", ")}`,
      };
    }
    // Checked before invoicing so an outage costs the buyer nothing: no invoice, no payment.
    if (!mockMode() && !(await livePrices())) {
      return {
        kind: "error",
        status: 503,
        message: "price upstream unavailable; nothing was invoiced, try again shortly",
      };
    }
    return { kind: "invoice", units: symbols.length, request: { symbols } };
  },
  deliver: async (invoice) => {
    const { symbols } = invoice.request as { symbols: string[] };
    const mock = mockMode();
    const live = mock ? null : await livePrices();
    if (!mock && !live) {
      throw new DeliveryUnavailable(
        "price upstream unavailable; your payment is kept, redeem again",
      );
    }
    const prices = mock ? MOCK_USD : (live as Snapshot).prices;
    const missing = symbols.filter((s) => typeof prices[s] !== "number");
    if (missing.length > 0) {
      throw new DeliveryUnavailable(`no upstream price for ${missing.join(", ")}; redeem again`);
    }
    return {
      // When the price was read, not when it was served: a cached figure says its own age.
      as_of: new Date(mock ? nowSeconds() * 1000 : (live as Snapshot).at).toISOString(),
      source: mock ? "mock" : "coingecko",
      prices_usd: Object.fromEntries(symbols.map((s) => [s, prices[s]] as const)),
    };
  },
};
