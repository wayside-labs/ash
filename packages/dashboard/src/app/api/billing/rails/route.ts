import { railsConfig } from "@/lib/server/billing/rails";

export const dynamic = "force-dynamic";

/** Which deposit rails this server takes. Region-independent: `/api/region` decides what is shown. */
export function GET() {
  return Response.json(railsConfig());
}
