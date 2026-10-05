import { handleInterest } from "../../src/lib/interest-handler";
import type { D1Like, LeadEnv } from "../../src/lib/lead-handler";

interface Context { request: Request; env: LeadEnv & { DB: D1Like } }

export const onRequest = (): Response =>
  new Response(null, { status: 405, headers: { allow: "POST" } });

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  const body = await request.json().catch(() => null);
  const r = await handleInterest(body, { db: env.DB, env });
  return Response.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
}
