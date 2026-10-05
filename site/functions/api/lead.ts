import { handleLead, type D1Like, type LeadEnv } from "../../src/lib/lead-handler";

// Thin adapter: everything worth testing lives in handleLead. Without an explicit fallback, Pages
// serves the home page for a GET here, which looks like an endpoint that answers; 405 says it doesn't.
interface Context { request: Request; env: LeadEnv & { DB: D1Like } }

export const onRequest = (): Response =>
  new Response(null, { status: 405, headers: { allow: "POST" } });

export async function onRequestPost({ request, env }: Context): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, errors: ["json"] }, { status: 400 });
  }
  const r = await handleLead(body, { db: env.DB, fetch: (u, i) => fetch(u, i), env });
  return Response.json(r.body, { status: r.status, headers: { "cache-control": "no-store" } });
}
