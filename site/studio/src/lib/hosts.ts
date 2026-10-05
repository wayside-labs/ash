export type Surface = "admin" | "public" | "internal" | "deny";

// Exact paths, or a prefix ending in "/": "/descadastro-falso" must not ride on "/descadastro".
// Exported for tests/app-guards.test.ts, which holds every file under src/app to this list.
export const PUBLIC_ROUTES = ["/api/public/", "/newsletter/", "/descadastro", "/media/"];
const LOOPBACK = new Set(["127.0.0.1", "localhost"]);

function matches(route: string, pathname: string): boolean {
  return route.endsWith("/") ? pathname.startsWith(route) : pathname === route;
}

export function surfaceFor(
  host: string | null,
  pathname: string,
  hosts: { studio: string; pub: string },
): Surface {
  const name = (host ?? "").toLowerCase().split(":")[0] ?? "";
  if (name === hosts.studio) return "admin";
  if (name === hosts.pub) return PUBLIC_ROUTES.some((r) => matches(r, pathname)) ? "public" : "deny";
  // "internal" is only a claim made by the Host header: any container on the Docker network can
  // send Host: 127.0.0.1. That is why this surface exposes /api/health alone, and health must
  // never carry anything sensitive.
  if (LOOPBACK.has(name) && pathname === "/api/health") return "internal";
  return "deny";
}
