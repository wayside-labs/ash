import { serverT } from "@/lib/server/i18n";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { unauthorizedStateResponse } from "@/lib/server/state/context";
import { billingConfig, resolveBillingScope } from "./meter";
import {
  getPendingIntent,
  type IntentRecord,
  type SolanaPayConfig,
  solanaPayConfig,
} from "./rails";
import { feePayer } from "./sponsored-deposit";

/**
 * What both halves of a connected-wallet deposit (`pay`, `submit`) settle before the fee payer
 * is touched: the rail is on, there is a session, and the id names the caller's own pending
 * intent on the cluster this server sends to. An intent opened before the operator switched
 * clusters names a mint the server no longer pays on, so it reads as not found.
 *
 * The caller runs `assertSameOrigin` first: `route-guard.test.ts` reads each handler for it.
 */
export async function sponsoredDepositContext(
  id: string,
  bucket: string,
  limit: number,
): Promise<{ response: Response } | { config: SolanaPayConfig; intent: IntentRecord }> {
  const config = solanaPayConfig();
  if (!billingConfig().enabled || !config || !feePayer()) {
    const error = await serverT("deposit.error.railOff");
    return { response: Response.json({ error }, { status: 503 }) };
  }
  const scope = await resolveBillingScope();
  if (!scope) return { response: unauthorizedStateResponse() };
  const limited = checkFixedWindow(
    `${bucket}:${scope.kind === "org" ? scope.orgId : "local"}`,
    limit,
  );
  if (limited) return { response: limited };

  const intent = /^[0-9a-f-]{36}$/i.test(id) ? await getPendingIntent(scope, id) : null;
  if (!intent || intent.cluster !== config.cluster) {
    const error = await serverT("deposit.error.notFound");
    return { response: Response.json({ error }, { status: 404 }) };
  }
  return { config, intent };
}
