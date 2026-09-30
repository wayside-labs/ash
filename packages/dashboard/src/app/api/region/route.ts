import { currencyFor, normalizeCountry, type Region } from "@/lib/region";
import { getUsdBrl } from "@/lib/server/billing/fx";

export const dynamic = "force-dynamic";

/**
 * The viewer's country as the edge saw it, and the rate to show their balance in. Behind the
 * VPS's Cloudflare tunnel every request carries `CF-IPCountry`; elsewhere it is absent, the
 * country comes back null, and the client falls back to the browser's time zone and language.
 *
 * `?country=BR` lets that fallback fetch the rate for a country the browser inferred. It only
 * picks which rate to return — a public exchange rate — so trusting it costs nothing.
 */
export async function GET(req: Request) {
  const edge = normalizeCountry(req.headers.get("cf-ipcountry"));
  const hinted = normalizeCountry(new URL(req.url).searchParams.get("country"));
  const country = edge ?? hinted;
  const currency = currencyFor(country);

  let usdRate: number | null = 1;
  if (currency === "BRL") usdRate = (await getUsdBrl())?.rate ?? null;

  const region: Region & { detectedBy: "edge" | "hint" | "none" } = {
    country,
    currency,
    usdRate,
    detectedBy: edge ? "edge" : hinted ? "hint" : "none",
  };
  return Response.json(region, { headers: { "cache-control": "private, max-age=300" } });
}
