import { z } from "zod";
import { usdToMicros } from "@/lib/billing";
import { billingConfig, currentBalance, resolveBillingScope } from "@/lib/server/billing/meter";
import {
  listWithdrawals,
  MIN_WITHDRAWAL_MICROS,
  requestWithdrawal,
  validDestination,
} from "@/lib/server/billing/rails";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { unauthorizedStateResponse } from "@/lib/server/state/context";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({
  amountUsd: z.string().max(16),
  destinationKind: z.enum(["solana_usdc"]),
  destination: z.string().max(200),
});

export async function GET() {
  if (!billingConfig().enabled) return Response.json({ requests: [] });
  const scope = await resolveBillingScope();
  if (!scope) return unauthorizedStateResponse();
  return Response.json({ requests: await listWithdrawals(scope) });
}

/**
 * A request, not a payout: the amount is held on the ledger now and the operator sends it by
 * hand (docs/runbooks/chat-credit-billing.md). Nothing here moves money off the platform.
 */
export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const config = billingConfig();
  if (!config.enabled) {
    return Response.json({ error: await serverT("deposit.error.billingOff") }, { status: 404 });
  }
  const scope = await resolveBillingScope();
  if (!scope) return unauthorizedStateResponse();
  const limited = checkFixedWindow(`withdraw:${scope.kind === "org" ? scope.orgId : "local"}`, 5);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: await serverT("api.error.invalidPayload") }, { status: 422 });
  }
  let amountMicros = 0;
  try {
    amountMicros = usdToMicros(parsed.data.amountUsd);
  } catch {}
  if (amountMicros < MIN_WITHDRAWAL_MICROS) {
    return Response.json({ error: await serverT("withdraw.error.amount") }, { status: 422 });
  }
  const destination = validDestination(parsed.data.destinationKind, parsed.data.destination);
  if (!destination) {
    return Response.json({ error: await serverT("withdraw.error.destination") }, { status: 422 });
  }

  const balance = await currentBalance(scope, config);
  const result = await requestWithdrawal(
    scope,
    balance,
    amountMicros,
    parsed.data.destinationKind,
    destination,
  );
  if (!result.ok) {
    const key = result.reason === "busy" ? "withdraw.error.busy" : "withdraw.error.insufficient";
    return Response.json({ error: await serverT(key) }, { status: 409 });
  }
  return Response.json({ request: result.request }, { status: 201 });
}
