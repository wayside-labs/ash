import { NextResponse } from "next/server";
import { ensureAccountForUser } from "@/lib/server/auth/bootstrap";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return NextResponse.redirect(new URL("/account?error=supabase", request.url));
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/account";

  if (!code) {
    return NextResponse.redirect(new URL("/account?error=auth", request.url));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(new URL("/account?error=auth", request.url));
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    try {
      await ensureAccountForUser(user);
    } catch {
      return NextResponse.redirect(new URL("/account?error=bootstrap", request.url));
    }
  }

  return NextResponse.redirect(new URL(next, request.url));
}
