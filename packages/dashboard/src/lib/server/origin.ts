/**
 * CSRF floor for every mutating handler (#19).
 *
 * Once a session lives in a cookie (ADR-017), a cross-site request carries it:
 * `req.json()` parses regardless of `content-type`, so a `text/plain` POST from
 * a hostile page is a *simple request* with no preflight for CORS to block.
 * CORS stops the attacker reading the response; it does not stop the write.
 *
 * Deliberately a per-route helper rather than `middleware.ts`. Middleware does
 * not run when a test calls `POST(new Request(...))` directly, so the origin
 * tests would pass green against code the middleware never executed. The
 * enumeration test in `route-guard.test.ts` buys back what a single chokepoint
 * would have given.
 */

/** Development only — see `allowedOrigins`. */
const DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

function allowedOrigins(): string[] {
  const declared = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  // In production the allowlist is exactly what the deployment declares. The
  // localhost entries are not harmless there: a page served from
  // `http://localhost:3000` on the visitor's own machine would otherwise be a
  // permitted origin against the hosted domain, which is the hole this check
  // exists to close.
  return process.env.NODE_ENV === "production" ? declared : [...DEV_ORIGINS, ...declared];
}

function allowedHosts(origins: string[]): Set<string> {
  const hosts = new Set<string>();
  for (const origin of origins) {
    try {
      hosts.add(new URL(origin).host);
    } catch {
      // A malformed entry in ALLOWED_ORIGINS narrows the allowlist rather than
      // widening it, so it is skipped instead of throwing at request time.
    }
  }
  return hosts;
}

function deny(reason: string): Response {
  // Not localized: a legitimate user never sees this, and an i18n key would put
  // the reason in the message catalogue for no reader.
  return Response.json({ error: `forbidden: ${reason}` }, { status: 403 });
}

/**
 * Returns a 403 to hand back, or `null` when the request may proceed.
 *
 * Absence of `Origin` is a denial, not a pass: browsers send it on every POST,
 * so a request without one is not a browser — and "anything that can reach the
 * port" is precisely the threat model here.
 */
export function assertSameOrigin(req: Request): Response | null {
  const origins = allowedOrigins();
  if (origins.length === 0) {
    return deny("no allowed origin configured");
  }

  // Sent by every current browser and not forgeable from script. `same-origin`
  // is what the dashboard's own fetches produce; `cross-site`, `same-site` and
  // `none` are not.
  const site = req.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") {
    return deny("cross-site request");
  }

  const origin = req.headers.get("origin");
  if (origin === null) {
    return deny("missing origin");
  }
  if (!origins.includes(origin)) {
    return deny("origin not allowed");
  }

  // Compared against the fixed allowlist, never against this request's own
  // `Host`. Under DNS rebinding the attacker controls both headers — `evil.com`
  // resolving to 127.0.0.1 sends `Origin: http://evil.com` *and*
  // `Host: evil.com:3000`, which match each other perfectly.
  const host = req.headers.get("host");
  if (host !== null && !allowedHosts(origins).has(host)) {
    return deny("host not allowed");
  }

  return null;
}

/**
 * The origin a browser should be sent back to. Behind a proxy (the VPS tunnel) the request's
 * own URL is the loopback listener, so a redirect built from it lands the user on
 * `localhost`; a deployment states its public URL in `DASHBOARD_PUBLIC_URL`. Never derived
 * from `Host` or `X-Forwarded-Host`, which the caller controls.
 */
export function publicOrigin(req: Request): string {
  const declared = process.env.DASHBOARD_PUBLIC_URL?.trim().replace(/\/+$/, "");
  return declared || new URL(req.url).origin;
}
