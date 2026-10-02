import {
  assertIsFullySignedTransaction,
  type Base64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  isSolanaError,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
} from "@solana/kit";
import { z } from "zod";
import { solanaClusterSchema } from "@/lib/schema";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { rpcFor } from "@/lib/server/solana";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  cluster: solanaClusterSchema,
  rpc: z.string().nullable().default(null),
  /** Wire bytes as base64. A transaction is at most 1232 bytes: under 1700 characters. */
  transaction: z.string().min(1).max(2048),
});

/**
 * Sends a transaction the browser's wallet has already signed, on the dashboard's cluster.
 * Wallets are asked only to sign (`solana:signTransaction`): one that also sent would send on
 * its own network setting, and a devnet transaction from a wallet left on mainnet never lands.
 * This signs nothing and adds nothing — anyone may hand a signed transaction to a public RPC —
 * so the one check is that no signature is missing.
 */
export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const limited = checkFixedWindow("api");
  if (limited) return limited;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: await serverT("api.error.invalidPayload"), issues: parsed.error.issues },
      { status: 422 },
    );
  }
  const { cluster, rpc, transaction } = parsed.data;
  try {
    assertIsFullySignedTransaction(
      getTransactionDecoder().decode(getBase64Encoder().encode(transaction)),
    );
  } catch {
    return Response.json(
      { error: await serverT("api.error.unsignedTransaction") },
      { status: 422 },
    );
  }

  try {
    const signature = await rpcFor(cluster, rpc)
      .sendTransaction(transaction as Base64EncodedWireTransaction, {
        encoding: "base64",
        preflightCommitment: "confirmed",
      })
      .send();
    return Response.json({ signature });
  } catch (error) {
    // By code, not message: Kit strips error messages from production builds.
    if (
      isSolanaError(error, SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE)
    ) {
      if (isSolanaError(error.cause, SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND)) {
        return Response.json(
          { error: await serverT("api.error.transactionExpired") },
          { status: 409 },
        );
      }
      // The program's own words are in the simulation logs: Anchor writes its error there.
      const detail =
        [...(error.context.logs ?? [])].reverse().find((line) => /error/i.test(line)) ??
        error.message;
      return Response.json(
        { error: await serverT("api.error.sendRefused", { detail }) },
        { status: 422 },
      );
    }
    console.error("[solana] send failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : await serverT("api.error.sendFailed") },
      { status: 502 },
    );
  }
}
