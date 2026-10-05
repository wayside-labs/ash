import { type Env, env } from "./env";

// For every admin route handler that changes something (anything but GET/HEAD). The admin's
// credential is a Cloudflare Access cookie the browser attaches by itself, so a page on another
// site could submit a form here and the request would arrive authenticated. Server actions get
// this check from Next; a route handler does not.
//
// Two headers the browser sets and a page cannot forge:
// - Sec-Fetch-Site, when present, must be "same-origin" ("same-site" is another subdomain, e.g.
//   the public host, and is refused);
// - Origin, when present, must be exactly the studio's origin.
// A request with neither is refused: every current browser sends at least one on a POST, and a
// script that sends none can add them.
//
// Returns the refusal to send back, or null to go on. Use it right after requireAdmin():
//   const refused = refuseCrossSite(request);
//   if (refused) return refused;
// tests/app-guards.test.ts requires exactly this in every non-GET admin handler.
export function refuseCrossSite(
  request: Request,
  e: Pick<Env, "STUDIO_HOST" | "NODE_ENV"> = env(),
): Response | null {
  const site = request.headers.get("sec-fetch-site");
  const origin = request.headers.get("origin");
  const allowed =
    (site !== null || origin !== null) &&
    (site === null || site === "same-origin") &&
    (origin === null || isStudioOrigin(origin, e));
  if (allowed) return null;
  return Response.json(
    { ok: false, error: "Pedido de outra origem recusado." },
    { status: 403, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
  );
}

function isStudioOrigin(origin: string, e: Pick<Env, "STUDIO_HOST" | "NODE_ENV">): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    // "null" (sandboxed frame, some redirects) and anything that is not a URL.
    return false;
  }
  // An Origin header is scheme://host[:port] and nothing else; compared against what the parser
  // understood, so userinfo, a path or odd casing cannot slip a different host through.
  if (url.origin.toLowerCase() !== origin.toLowerCase()) return false;
  if (url.hostname !== e.STUDIO_HOST) return false;
  // Local dev runs on http://localhost:3100. Everywhere else: https on the default port.
  if (e.NODE_ENV === "development") return true;
  return url.protocol === "https:" && url.port === "";
}
