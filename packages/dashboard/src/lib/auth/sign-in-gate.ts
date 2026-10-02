/** Where a signed-out visitor is sent: the account page carries both sign-in doors. */
export const SIGN_IN_PATH = "/account";

/**
 * Readable before signing in: the sign-in screen links to them and the agreement is only
 * meaningful if a visitor can read it first. Exact paths, so nothing beneath them opens up.
 */
export const LEGAL_PATHS: readonly string[] = ["/terms", "/privacy"];

const SAME_SITE = "http://same-site.invalid";

/**
 * Only a same-site path. Prefix checks alone are not enough: the URL parser treats `\` as `/`
 * and strips tabs and newlines, so `/\evil.example` and `/\t/evil.example` both resolve off-site.
 * Resolving against a placeholder origin and comparing asks the parser itself.
 */
export function safeNext(next: string | null | undefined, fallback = SIGN_IN_PATH): string {
  if (!next?.startsWith("/")) return fallback;
  try {
    const url = new URL(next, SAME_SITE);
    return url.origin === SAME_SITE ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Hosted mode only (ADR-017): whether a request with no session should be sent to sign in
 * instead of rendering a dashboard whose every `/api/state` read answers 401.
 *
 * API routes keep answering JSON 401 — a redirect there would hand `fetch` an HTML page.
 * The sign-in page itself, the OAuth callback and the legal pages must stay reachable, and anything with a
 * file extension is an asset or a browser probe (`manifest.json`, `robots.txt`).
 */
export function needsSignIn(pathname: string): boolean {
  if (pathname === SIGN_IN_PATH || pathname.startsWith(`${SIGN_IN_PATH}/`)) return false;
  if (LEGAL_PATHS.includes(pathname)) return false;
  if (pathname === "/api" || pathname.startsWith("/api/")) return false;
  if (pathname === "/auth" || pathname.startsWith("/auth/")) return false;
  if (pathname.startsWith("/_next/")) return false;
  const last = pathname.slice(pathname.lastIndexOf("/") + 1);
  if (last.includes(".")) return false;
  return true;
}

/** `/account?next=<path+query>`, or bare `/account` when the visitor was headed home. */
export function signInUrl(pathname: string, search: string): string {
  const target = `${pathname}${search}`;
  if (target === "/" || target === "") return SIGN_IN_PATH;
  return `${SIGN_IN_PATH}?next=${encodeURIComponent(target)}`;
}
