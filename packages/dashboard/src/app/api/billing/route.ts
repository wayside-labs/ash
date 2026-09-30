import type { BillingSummary } from "@/lib/billing";
import { ledgerFor } from "@/lib/server/billing/ledger";
import { billingConfig, currentBalance, resolveBillingScope } from "@/lib/server/billing/meter";
import { serverT } from "@/lib/server/i18n";
import { unauthorizedStateResponse } from "@/lib/server/state/context";

export const dynamic = "force-dynamic";

const HISTORY_LIMIT = 50;

/**
 * The caller's credit balance and recent ledger. Read-only on purpose: there is
 * no route that adds credit. Deposits arrive through a payment rail's verified
 * callback, and a manual adjustment is a service-role insert an operator makes
 * by hand (docs/runbooks/chat-credit-billing.md) — never a request a signed-in
 * user can send.
 */
export async function GET() {
  const config = billingConfig();
  if (!config.enabled) {
    const off: BillingSummary = {
      enabled: false,
      balanceMicros: 0,
      markupBps: config.markupBps,
      entries: [],
    };
    return Response.json(off);
  }

  const scope = await resolveBillingScope();
  if (!scope) return unauthorizedStateResponse();

  try {
    const balanceMicros = await currentBalance(scope, config);
    const entries = await ledgerFor(scope).entries(scope, HISTORY_LIMIT);
    const summary: BillingSummary = {
      enabled: true,
      balanceMicros,
      markupBps: config.markupBps,
      entries,
    };
    return Response.json(summary);
  } catch (error) {
    console.error("[billing] ledger read failed:", error);
    return Response.json({ error: await serverT("llm.error.billingUnavailable") }, { status: 503 });
  }
}
