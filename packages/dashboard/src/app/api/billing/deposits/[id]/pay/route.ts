import { address, isAddress } from "@solana/kit";
import { buildSponsoredDeposit } from "@/lib/server/billing/sponsored-deposit";
import { sponsoredDepositContext } from "@/lib/server/billing/sponsored-route";
import { serverT } from "@/lib/server/i18n";
import { assertSameOrigin } from "@/lib/server/origin";

export const dynamic = "force-dynamic";

/**
 * First half of a fee-covered deposit from the connected wallet: the unsigned transfer, with the
 * platform as fee payer, for the wallet to sign. Nothing is signed here — `submit` reads what the
 * wallet signed before the fee payer adds anything (`sponsored-deposit.ts` says why).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const opened = await sponsoredDepositContext((await params).id, "deposit-pay", 20);
  if ("response" in opened) return opened.response;

  const body = (await req.json().catch(() => null)) as { account?: unknown } | null;
  const account = typeof body?.account === "string" ? body.account : "";
  if (!isAddress(account)) {
    return Response.json({ error: await serverT("deposit.error.account") }, { status: 400 });
  }
  try {
    const transaction = await buildSponsoredDeposit(opened.config, opened.intent, address(account));
    return Response.json({ transaction });
  } catch (error) {
    console.error("[billing] sponsored deposit build failed:", error);
    return Response.json({ error: await serverT("deposit.error.prepare") }, { status: 502 });
  }
}
