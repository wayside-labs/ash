import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { safeNext } from "@/lib/auth/sign-in-gate";
import { ensureAccountForUser } from "@/lib/server/auth/bootstrap";
import { publicOrigin } from "@/lib/server/origin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** The types a magic-link or sign-up email carries; recovery and email change are not doors. */
const SIGN_IN_TYPES = new Set<EmailOtpType>(["email", "magiclink", "signup"]);

/**
 * Magic-link landing for the token-hash template (ADR-024, runbook).
 *
 * `/auth/callback` exchanges a PKCE code, which needs the verifier cookie of the browser that
 * *asked* for the link. On a phone the email app usually opens the link in a different one — its
 * own in-app browser — and the exchange fails. `verifyOtp` with the token hash needs nothing
 * from the requesting browser, so the link works wherever it is opened.
 */
export async function GET(request: Request) {
  const back = (path: string) => NextResponse.redirect(new URL(path, publicOrigin(request)));

  if (!isSupabaseConfigured()) {
    return back("/account?error=supabase");
  }

  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next"), "/");

  if (!tokenHash || !type || !SIGN_IN_TYPES.has(type)) {
    return back("/account?error=auth");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
  if (error || !user) {
    return back("/account?error=auth");
  }

  try {
    await ensureAccountForUser(user);
  } catch (bootstrapError) {
    console.error("auth confirm: account bootstrap failed", bootstrapError);
    return back("/account?error=bootstrap");
  }

  return back(next);
}
