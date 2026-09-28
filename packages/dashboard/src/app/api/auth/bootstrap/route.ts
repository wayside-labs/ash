import { ensureAccountForUser } from "@/lib/server/auth/bootstrap";
import { assertSameOrigin } from "@/lib/server/origin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Provisioning for the sign-in that has no redirect to hang it on.
 *
 * Google arrives through `/auth/callback`, which can call the bootstrap inline.
 * `signInWithWeb3` never leaves the page, so the browser asks for the same work
 * here once the session exists.
 *
 * The user comes from the session, never from the body: the wallet address
 * decides `identities.subject`, and a caller allowed to name its own would be
 * claiming someone else's account.
 */
export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;

  if (!isSupabaseConfigured()) {
    return Response.json({ error: "supabase not configured" }, { status: 503 });
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const accountId = await ensureAccountForUser(user);
    return Response.json({ accountId });
  } catch (cause) {
    // The message names the provider or the missing address, and it is the only
    // signal the client has for why an otherwise valid sign-in left them
    // without an account.
    console.error("[auth/bootstrap]", cause);
    return Response.json(
      { error: cause instanceof Error ? cause.message : "bootstrap failed" },
      { status: 500 },
    );
  }
}
