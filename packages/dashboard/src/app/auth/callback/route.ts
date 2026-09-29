import { NextResponse } from "next/server";
import { ensureAccountForUser } from "@/lib/server/auth/bootstrap";
import { publicOrigin } from "@/lib/server/origin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/** Only a same-site path: `//evil.example` or an absolute URL in `next` would leave the site. */
function safeNext(next: string | null): string {
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/account";
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
