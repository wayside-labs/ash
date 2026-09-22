import { assertSameOrigin } from "@/lib/server/origin";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const denied = assertSameOrigin(req);
  if (denied) return denied;

  if (!isSupabaseConfigured()) {
    return Response.json({ ok: true });
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ ok: true });
}
