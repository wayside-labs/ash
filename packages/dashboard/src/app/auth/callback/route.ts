import { NextResponse } from "next/server";
import { ensureAccountForUser } from "@/lib/server/auth/bootstrap";
import { publicOrigin } from "@/lib/server/origin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const SAME_SITE = "http://same-site.invalid";

/**
 * Only a same-site path. Prefix checks alone are not enough: the URL parser treats `\` as `/`
 * and strips tabs and newlines, so `/\evil.example` and `/\t/evil.example` both resolve off-site.
 */
function safeNext(next: string | null): string {
  if (!next?.startsWith("/")) return "/account";
  try {
    const url = new URL(next, SAME_SITE);
    return url.origin === SAME_SITE ? `${url.pathname}${url.search}${url.hash}` : "/account";
  } catch {
    return "/account";
  }
}

export async function GET(request: Request) {
  const back = (path: string) => NextResponse.redirect(new URL(path, publicOrigin(request)));

  if (!isSupabaseConfigured()) {
    return back("/account?error=supabase");
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (!code) {
    return back("/account?error=auth");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return back("/account?error=auth");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    try {
      await ensureAccountForUser(user);
    } catch (bootstrapError) {
      // The user only sees `error=bootstrap`; without this line the cause (a missing table,
      // a wrong service-role key) is invisible in the server journal too.
      console.error("auth callback: account bootstrap failed", bootstrapError);
      return back("/account?error=bootstrap");
    }
  }

  return back(next);
}
