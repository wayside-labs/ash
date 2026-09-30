import type { User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = {
  id: string;
  email: string | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;

  return { id: user.id, email: user.email ?? null };
}

export async function requireSessionUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) {
    throw new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  return user;
}

export function toSessionUser(user: User): SessionUser {
  return { id: user.id, email: user.email ?? null };
}

/**
 * Hosted mode (ADR-017): a signed-in user, or a 401 to return. The local JSON-store mode has
 * no accounts, so there is nothing to check and the route proceeds.
 */
export async function hostedSessionDenied(): Promise<Response | null> {
  if (!isSupabaseConfigured()) return null;
  if (await getSessionUser()) return null;
  return Response.json({ error: "unauthorized" }, { status: 401 });
}
