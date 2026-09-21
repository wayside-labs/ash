import { serverT } from "@/lib/server/i18n";
import { getSolUsdPrice } from "@/lib/server/price";

export const dynamic = "force-dynamic";

export async function GET() {
  const price = await getSolUsdPrice();
  if (!price) {
    return Response.json({ error: await serverT("api.error.priceUnavailable") }, { status: 502 });
  }
  return Response.json(price);
}
