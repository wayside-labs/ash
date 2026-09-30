import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { needsSignIn, signInUrl } from "@/lib/auth/sign-in-gate";
import { publicOrigin } from "@/lib/server/origin";
import { isSupabaseConfigured, requirePublicSupabaseEnv } from "./env";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  if (!isSupabaseConfigured()) {
    return response;
  }

  const { url, anonKey } = requirePublicSupabaseEnv();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Refreshes the session cookie when expired. Do not insert logic between
  // createServerClient and this call — the library relies on that ordering.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Hosted mode has no anonymous dashboard: without this, a signed-out visitor got the full
  // shell and every `/api/state` read or write answered 401 behind it.
  const { pathname, search } = request.nextUrl;
  if (!user && needsSignIn(pathname)) {
    // The public origin, not `request.url`: behind the tunnel that is the loopback the
    // server listens on (the same trap bae2f3e fixed for the OAuth callback).
    const target = new URL(signInUrl(pathname, search), publicOrigin(request));
    const redirect = NextResponse.redirect(target);
    // An expired session is cleared through these cookies; dropping them would leave the
    // stale token in the browser and send it back on every request.
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie);
    }
    return redirect;
  }

  return response;
}
