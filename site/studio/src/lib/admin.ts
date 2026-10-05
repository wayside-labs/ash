import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { ACCESS_HEADER, adminFromToken } from "./admin-token";

// Every admin page, route and server action calls this. The proxy is a first gate only: the
// Next 16 docs warn that a matcher change can silently drop proxy coverage.
export async function requireAdmin(): Promise<{ email: string }> {
  const who = await adminFromToken((await headers()).get(ACCESS_HEADER));
  if (!who) notFound();
  return who;
}
