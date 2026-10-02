import type { QueryClient } from "@tanstack/react-query";
import { isUnauthorized, isUnprovisioned } from "@/lib/http-error";
import { needsSignIn, SIGN_IN_PATH, signInUrl } from "./sign-in-gate";

/** One provisioning attempt per page load; a second failure is not fixed by a third. */
let reprovision: Promise<boolean> | null = null;

/**
 * The middleware keeps signed-out visitors off dashboard pages, but a session can still
 * expire under an open tab, or sign-in can succeed while account setup fails. Either left
 * the page mute behind a wall of 401s; this turns them into the step that fixes them.
 */
export function recoverFromAuthError(error: unknown, queryClient: QueryClient): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;

  if (isUnauthorized(error)) {
    // The root providers read `/api/state` on every page, public ones included; a signed-out
    // visitor on `/terms` gets a 401 there and must be left reading, not bounced.
    if (!needsSignIn(pathname)) return;
    window.location.assign(signInUrl(pathname, search));
    return;
  }

  if (isUnprovisioned(error)) {
    reprovision ??= fetch("/api/auth/bootstrap", { method: "POST" })
      .then((res) => res.ok)
      .catch(() => false);
    void reprovision.then((ok) => {
      if (ok) {
        void queryClient.invalidateQueries();
      } else if (!search.includes("error=bootstrap")) {
        // The account page already explains this error and how to fix it.
        window.location.assign(`${SIGN_IN_PATH}?error=bootstrap`);
      }
    });
  }
}

/** Nothing but a new session or a provisioned account changes these answers. */
export function retryUnlessAuth(failureCount: number, error: unknown): boolean {
  if (isUnauthorized(error) || isUnprovisioned(error)) return false;
  return failureCount < 1;
}
