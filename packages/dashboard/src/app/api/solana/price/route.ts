import { serverT } from "@/lib/server/i18n";
import { getSolUsdPrice } from "@/lib/server/price";

export const dynamic = "force-dynamic";

/** How long the client should wait before asking again when every upstream refused. */
const RETRY_AFTER_SECONDS = 60;

export async function GET() {
  // `getSolUsdPrice` already falls back to the last good read, so reaching here means this
  // process has never had one. 503, not 502: the upstreams are down, not misbehaving.
  const price = await getSolUsdPrice();
  if (!price) {
    return Response.json(
      { error: await serverT("api.error.priceUnavailable") },
      { status: 503, headers: { "Retry-After": String(RETRY_AFTER_SECONDS) } },
    );
  }
  return Response.json(price);
}
