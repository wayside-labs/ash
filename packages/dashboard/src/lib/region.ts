/**
 * Where the viewer is, as far as money is concerned: which currency the balance is shown in and
 * which deposit rails are offered. Pure and client-safe.
 *
 * Presentation only. The ledger is USD whatever this says, a rail's availability is decided by
 * its server config, and a wrong guess costs a viewer one extra option or a converted figure —
 * never access to anything.
 */

export type DisplayCurrency = "USD" | "BRL";

export type DepositRail = "pix" | "solana_pay_usdc";

export type Region = {
  /** ISO 3166-1 alpha-2, upper case; null when neither the edge nor the browser said. */
  country: string | null;
  currency: DisplayCurrency;
  /** Units of `currency` per USD; 1 for USD, null when no rate could be read. */
  usdRate: number | null;
};

/** Cloudflare's placeholders: `XX` is unknown, `T1` is Tor. Neither is a country. */
export function normalizeCountry(raw: string | null | undefined): string | null {
  const code = raw?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code) || code === "XX" || code === "T1") return null;
  return code;
}

export function currencyFor(country: string | null): DisplayCurrency {
  return country === "BR" ? "BRL" : "USD";
}

/**
 * PIX is Brazil's; everyone gets USDC over Solana Pay. USDC rather than USDT or SOL because it
 * is the stablecoin Solana wallets hold most, and it maps 1:1 onto the USD ledger with no price
 * to read at deposit time.
 */
export function depositRailsFor(country: string | null): DepositRail[] {
  return country === "BR" ? ["pix", "solana_pay_usdc"] : ["solana_pay_usdc"];
}

// Brazil's IANA zones, for when the edge sent no country (local dev, another proxy).
const BRAZIL_ZONES = new Set([
  "America/Sao_Paulo",
  "America/Bahia",
  "America/Fortaleza",
  "America/Recife",
  "America/Maceio",
  "America/Belem",
  "America/Araguaina",
  "America/Manaus",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Porto_Velho",
  "America/Boa_Vista",
  "America/Rio_Branco",
  "America/Eirunepe",
  "America/Santarem",
  "America/Noronha",
]);

/** The browser's best guess: a Brazilian time zone, else a `pt-BR` language. */
export function countryFromBrowser(timeZone: string | undefined, languages: readonly string[]) {
  if (timeZone && BRAZIL_ZONES.has(timeZone)) return "BR";
  if (languages.some((lang) => lang.toLowerCase() === "pt-br")) return "BR";
  return null;
}

/** Micro-USD in the viewer's currency. Falls back to USD when there is no rate to convert with. */
export function formatBalance(micros: number, region: Region, locale: string): string {
  const usd = micros / 1_000_000;
  const convert = region.currency !== "USD" && region.usdRate !== null;
  const value = convert ? usd * (region.usdRate as number) : usd;
  const abs = Math.abs(value);
  const digits = abs !== 0 && abs < 0.01 ? 4 : 2;
  // Reais read the Brazilian way ("R$ 11,00") whatever language the dashboard is in.
  return new Intl.NumberFormat(convert && region.currency === "BRL" ? "pt-BR" : locale, {
    style: "currency",
    currency: convert ? region.currency : "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
}

export const DEFAULT_REGION: Region = { country: null, currency: "USD", usdRate: 1 };
