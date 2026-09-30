import { z } from "zod";
import { readAccountWallet, verifyLinkProof } from "@/lib/server/auth/platform-wallet";
import { assertSameOrigin } from "@/lib/server/origin";
import { checkFixedWindow } from "@/lib/server/rate-limit";
import { requirePostgresContext, StateAccessError } from "@/lib/server/state/context";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSupabaseConfigured } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

const linkSchema = z.object({
  address: z.string().min(32).max(44),
  message: z.string().max(300),
  signature: z.string().max(200),
  walletName: z.string().max(40).default(""),
});

const unlinkSchema = z.object({ address: z.string().min(32).max(44) });

/**
 * Links a self-custody wallet to the caller's account, on proof of control (ADR-024).
 *
 * The insert runs under the service role because RLS cannot check a signature; that is also
 * why it happens only after `verifyLinkProof` passes against the *session's* account id.
 */
export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  const limited = checkFixedWindow("api");
  if (limited) return limited;
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "linking needs hosted accounts" }, { status: 404 });
  }

  try {
    const ctx = await requirePostgresContext();
    const parsed = linkSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "invalid payload", issues: parsed.error.issues },
        { status: 422 },
      );
    }

    const summary = await readAccountWallet(ctx.supabase, ctx.accountId);
    if (!summary.externalWallets) {
      return Response.json({ error: "external wallets are a Pro feature" }, { status: 403 });
    }

    const proof = await verifyLinkProof({ accountId: ctx.accountId, ...parsed.data });
    if (!proof.ok) {
      return Response.json({ error: `link refused: ${proof.reason}` }, { status: 400 });
    }

    const { error } = await createAdminClient()
      .from("linked_wallets")
      .upsert(
        { account_id: ctx.accountId, address: proof.address, wallet_name: parsed.data.walletName },
        { onConflict: "account_id,address", ignoreDuplicates: true },
      );
    if (error) throw error;

    return Response.json({ linked: proof.address });
  } catch (cause) {
    if (cause instanceof StateAccessError) return cause.response;
    console.error("[account/wallet/link]", cause);
    return Response.json({ error: "could not link the wallet" }, { status: 500 });
  }
}

/** Unlinking needs no proof beyond the session, and runs under it: RLS scopes the delete. */
export async function DELETE(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "linking needs hosted accounts" }, { status: 404 });
  }

  try {
    const ctx = await requirePostgresContext();
    const parsed = unlinkSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: "invalid payload", issues: parsed.error.issues },
        { status: 422 },
      );
    }
    const { error } = await ctx.supabase
      .from("linked_wallets")
      .delete()
      .eq("account_id", ctx.accountId)
      .eq("address", parsed.data.address);
    if (error) throw error;
    return Response.json({ unlinked: parsed.data.address });
  } catch (cause) {
    if (cause instanceof StateAccessError) return cause.response;
    console.error("[account/wallet/link]", cause);
    return Response.json({ error: "could not unlink the wallet" }, { status: 500 });
  }
}
