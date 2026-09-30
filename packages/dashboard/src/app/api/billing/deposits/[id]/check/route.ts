import { billingConfig, resolveBillingScope } from "@/lib/server/billing/meter";
import { checkDepositIntent, solanaPayConfig } from "@/lib/server/billing/rails";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { unauthorizedStateResponse } from "@/lib/server/state/context";

export const dynamic = "force-dynamic";

/**
 * Polled by the deposit modal. POST because a hit can append a `deposit` row; the append is
 * keyed by the transaction signature, so polling it any number of times credits once.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const config = solanaPayConfig();
  if (!billingConfig().enabled || !config) {
    return Response.json({ error: await serverT("deposit.error.railOff") }, { status: 503 });
  }
  const scope = await resolveBillingScope();
  if (!scope) return unauthorizedStateResponse();
  // Each check is two or more RPC reads; the modal polls every few seconds.
  const limited = checkFixedWindow(
    `deposit-check:${scope.kind === "org" ? scope.orgId : "local"}`,
    40,
  );
  if (limited) return limited;

  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: await serverT("deposit.error.notFound") }, { status: 404 });
  }
  try {
    const intent = await checkDepositIntent(scope, config, id);
    if (!intent) {
      return Response.json({ error: await serverT("deposit.error.notFound") }, { status: 404 });
    }
    return Response.json({ intent });
  } catch (error) {
    console.error("[billing] deposit check failed:", error);
    return Response.json({ error: await serverT("deposit.error.check") }, { status: 502 });
  }
}
