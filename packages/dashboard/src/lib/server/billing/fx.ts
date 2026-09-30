/**
 * USD → BRL for showing a Brazilian viewer their balance in reais. Display only: the ledger,
 * deposits and withdrawals stay in USD, so a stale or missing rate changes a label, never an
 * amount. Keyless public sources in order, cached in-process like `lib/server/price.ts`.
 */

const CACHE_MS = 10 * 60_000;
const TIMEOUT_MS = 4_000;

export type FxRate = { rate: number; source: "awesomeapi" | "frankfurter"; asOf: string };

let cache: { at: number; value: FxRate } | null = null;
let inflight: Promise<FxRate | null> | null = null;

function positive(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
}

/** Brazilian, keyless, updated through the trading day. */
export function parseAwesomeApi(body: unknown): number | null {
  const entry = (body as { USDBRL?: { bid?: unknown } } | null)?.USDBRL;
  return positive(entry?.bid);
}

/** ECB reference rates: daily, but never refuses a datacenter IP. */
export function parseFrankfurter(body: unknown): number | null {
  return positive((body as { rates?: { BRL?: unknown } } | null)?.rates?.BRL);
}

async function read(): Promise<FxRate | null> {
  const sources = [
    ["awesomeapi", "https://economia.awesomeapi.com.br/json/last/USD-BRL", parseAwesomeApi],
    ["frankfurter", "https://api.frankfurter.app/latest?from=USD&to=BRL", parseFrankfurter],
  ] as const;
  const failures: string[] = [];
  for (const [source, url, parse] of sources) {
    try {
      const rate = parse(await fetchJson(url));
      if (rate === null) throw new Error("no rate in response");
      return { rate, source, asOf: new Date().toISOString() };
    } catch (err) {
      failures.push(`${source}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.warn(`usd/brl unavailable (${failures.join("; ")})`);
  return null;
}

export async function getUsdBrl(): Promise<FxRate | null> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  if (inflight) return inflight;
  inflight = read()
    .then((value) => {
      if (value) cache = { at: Date.now(), value };
      return value ?? cache?.value ?? null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
