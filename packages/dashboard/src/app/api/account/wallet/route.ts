import { canConnectExternalWallet } from "@/lib/plan";
import {
  type AccountWalletSummary,
  externalWalletPolicy,
  readAccountWallet,
} from "@/lib/server/auth/platform-wallet";
import {
  missingAccountResponse,
  resolvePostgresContext,
  unauthorizedStateResponse,
} from "@/lib/server/state/context";

export const dynamic = "force-dynamic";

/**
 * The account's platform wallet, its plan, and whether it may connect a self-custody wallet
 * (ADR-024). Read under the caller's session, so RLS decides whose rows come back.
 */
export async function GET() {
  const result = await resolvePostgresContext();

  if (result === null) {
    // Local JSON mode: no account, no platform wallet, and the operator's own extension is the
    // only signer there is.
    const local: AccountWalletSummary = {
      hosted: false,
      accountId: null,
      plan: "free",
      externalWallets: canConnectExternalWallet({
        hosted: false,
        plan: "free",
        policy: externalWalletPolicy(),
      }),
      platformWallet: null,
      linkedWallets: [],
    };
    return Response.json(local);
  }
  if (result.kind === "anonymous") return unauthorizedStateResponse();
  if (result.kind === "unprovisioned") return missingAccountResponse();

  try {
    return Response.json(await readAccountWallet(result.ctx.supabase, result.ctx.accountId));
  } catch (cause) {
    console.error("[account/wallet]", cause);
    return Response.json({ error: "could not read the account wallet" }, { status: 500 });
  }
}
