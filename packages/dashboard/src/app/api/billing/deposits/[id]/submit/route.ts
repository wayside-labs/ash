import {
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
} from "@solana/kit";
import {
  completeSponsoredDeposit,
  SponsoredDepositRefused,
} from "@/lib/server/billing/sponsored-deposit";
import { sponsoredDepositContext } from "@/lib/server/billing/sponsored-route";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

/** A v0 transaction is at most 1232 bytes, so its base64 is under 1700 characters. */
const MAX_BASE64_LENGTH = 2048;

/**
 * Second half of a fee-covered deposit: the transaction the wallet signed. The server checks it
 * is the transfer it built, adds the fee payer's signature and sends it to the deposit's own
 * cluster. Credit still lands only through `check`, from the finalized transfer.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const opened = await sponsoredDepositContext((await params).id, "deposit-submit", 10);
  if ("response" in opened) return opened.response;

  const body = (await req.json().catch(() => null)) as { transaction?: unknown } | null;
  const transaction = typeof body?.transaction === "string" ? body.transaction : "";
  if (!transaction || transaction.length > MAX_BASE64_LENGTH) {
    return Response.json({ error: await serverT("deposit.error.mismatch") }, { status: 422 });
  }
  try {
    const signature = await completeSponsoredDeposit(opened.config, opened.intent, transaction);
    console.info(`[billing] sponsored deposit sent intent=${opened.intent.id} tx=${signature}`);
    return Response.json({ signature });
  } catch (error) {
    if (error instanceof SponsoredDepositRefused) {
      console.warn(
        `[billing] sponsored deposit refused intent=${opened.intent.id}: ${error.reason}`,
      );
      return Response.json({ error: await serverT("deposit.error.mismatch") }, { status: 422 });
    }
    console.error("[billing] sponsored deposit send failed:", error);
    // By code, not message: Kit strips error messages from production builds.
    const expired =
      isSolanaError(
        error,
        SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
      ) && isSolanaError(error.cause, SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND);
    return expired
      ? Response.json({ error: await serverT("deposit.error.expired") }, { status: 409 })
      : Response.json({ error: await serverT("deposit.error.refused") }, { status: 502 });
  }
}
