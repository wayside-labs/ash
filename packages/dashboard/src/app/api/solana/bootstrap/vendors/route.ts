import { hostedSessionDenied } from "@/lib/server/auth/session";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { fetchVendorPresets } from "@/lib/server/vendors";

export const dynamic = "force-dynamic";

/** The bootstrap wizard's "devnet vendors" preset. An empty list means "type it in". */
export async function GET() {
  const unauthenticated = await hostedSessionDenied();
  if (unauthenticated) return unauthenticated;
  const limited = checkFixedWindow("api");
  if (limited) return limited;
  return Response.json({ vendors: await fetchVendorPresets() });
}
