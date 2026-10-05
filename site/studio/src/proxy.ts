import { type NextRequest, NextResponse } from "next/server";
import { ACCESS_HEADER, adminFromToken } from "@/lib/admin-token";
import { env } from "@/lib/env";
import { surfaceFor } from "@/lib/hosts";

function isServerActionLike(req: NextRequest): boolean {
  if (req.headers.has("next-action")) return true;
  const type = req.headers.get("content-type") ?? "";
  return req.method === "POST" && type.toLowerCase().startsWith("multipart/form-data");
}

export async function proxy(req: NextRequest) {
  const e = env();
  const surface = surfaceFor(req.headers.get("host"), req.nextUrl.pathname, {
    studio: e.STUDIO_HOST,
    pub: e.PUBLIC_HOST,
  });
  if (surface === "deny") return new NextResponse("Not found", { status: 404 });
  // Public pages use no server actions. Two transports are refused so an admin action cannot run
  // here: the `next-action` header (fetch-based calls) and multipart/form-data POSTs (plain HTML
  // forms carry the action id in the body). urlencoded POSTs stay open: the newsletter one-click
  // unsubscribe (RFC 8058) uses one.
  if (surface === "public" && isServerActionLike(req)) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (surface === "admin" && !(await adminFromToken(req.headers.get(ACCESS_HEADER), e))) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return NextResponse.next();
}

// Only build-time static assets skip the proxy. _next/image must stay covered: it would
// otherwise fetch and serve images from any host without classification.
export const config = { matcher: ["/((?!_next/static/|favicon\\.ico$).*)"] };
