import { z } from "zod";
import { usdToMicros } from "@/lib/billing";
import { billingConfig, resolveBillingScope } from "@/lib/server/billing/meter";
import { createDepositIntent, solanaPayConfig } from "@/lib/server/billing/rails";
import { ensureRecipientTokenAccount } from "@/lib/server/billing/sponsored-deposit";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { unauthorizedStateResponse } from "@/lib/server/state/context";
import { MAX_DEPOSIT_MICROS, MIN_DEPOSIT_MICROS } from "@/lib/solana-pay";

export const dynamic = "force-dynamic";

const bodySchema = z.strictObject({ amountUsd: z.string().max(16) });

/**
 * Opens a Solana Pay USDC request. It adds no credit: that happens only when
 * `deposits/[id]/check` finds a finalized transfer to the operator's address.
 */
export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  if (!billingConfig().enabled) {
    return Response.json({ error: await serverT("deposit.error.billingOff") }, { status: 404 });
  }
  const config = solanaPayConfig();
  if (!config) {
    return Response.json({ error: await serverT("deposit.error.railOff") }, { status: 503 });
  }
  const scope = await resolveBillingScope();
  if (!scope) return unauthorizedStateResponse();
  const limited = checkFixedWindow(`deposit:${scope.kind === "org" ? scope.orgId : "local"}`, 10);
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  let amountMicros = 0;
  try {
    amountMicros = parsed.success ? usdToMicros(parsed.data.amountUsd) : 0;
  } catch {}
  if (amountMicros < MIN_DEPOSIT_MICROS || amountMicros > MAX_DEPOSIT_MICROS) {
    return Response.json({ error: await serverT("deposit.error.amount") }, { status: 422 });
  }

  const intent = await createDepositIntent(scope, config, amountMicros);
  // Before anyone can scan: a transfer request cannot open the recipient's USDC account itself.
  await ensureRecipientTokenAccount(config).catch((error) => {
    console.error("[billing] could not open the recipient's USDC account:", error);
  });
  return Response.json({ intent }, { status: 201 });
}
