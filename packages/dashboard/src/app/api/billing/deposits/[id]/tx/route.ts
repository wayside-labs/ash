import { isAddress } from "@solana/kit";
import { findPendingIntent, solanaPayConfig } from "@/lib/server/billing/rails";
import { buildSponsoredDeposit, feePayer } from "@/lib/server/billing/sponsored-deposit";
import { publicOrigin } from "@/lib/server/origin";
import { checkFixedWindow } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Solana Pay transaction request (https://docs.solanapay.com/spec#specification-transaction-request).
 * Called by the customer's *wallet*, not by the dashboard: no cookie, often no browser, so
 * `assertSameOrigin` cannot apply (route-guard.test.ts lists it under WALLET_ROUTES). It reads
 * no session and returns nothing private: the unguessable intent id selects a transaction that
 * moves that intent's amount to the operator, with the platform paying the network fee.
 */

// Wallet apps fetch this from their own origin; nothing here depends on or sets a cookie.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS });
}

export function GET(req: Request) {
  return Response.json(
    { label: "Agent Rails", icon: `${publicOrigin(req)}/icon.svg` },
    { headers: CORS },
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = checkFixedWindow("deposit-tx", 120);
  if (limited) return limited;
  const fail = (status: number, error: string) =>
    Response.json({ error }, { status, headers: CORS });

  const config = solanaPayConfig();
  if (!config || !feePayer()) return fail(503, "deposits are not available");

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "unknown payment request");
  const intent = await findPendingIntent(id);
  if (!intent) return fail(404, "this payment request is unknown or already paid");

  const body = (await req.json().catch(() => null)) as { account?: unknown } | null;
  const account = typeof body?.account === "string" ? body.account : "";
  if (!isAddress(account)) return fail(400, "account must be a Solana address");

  try {
    const transaction = await buildSponsoredDeposit(config, intent, account);
    return Response.json(
      { transaction, message: "Assistant credit — network fee covered by Agent Rails" },
      { headers: CORS },
    );
  } catch (error) {
    console.error("[billing] sponsored deposit build failed:", error);
    return fail(502, "could not prepare the payment, try again");
  }
}
