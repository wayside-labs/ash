// Public on purpose (lib/hosts.ts lists /api/public/): no admin guard here, and for that very
// reason nothing but the public reader may be called from this file.
import { createHash } from "node:crypto";
import { readPublic } from "@/blog/public";
import { db } from "@/db/client";
import { env } from "@/lib/env";

// Read on every request; the minute of caching belongs to the browser and to the CDN.
export const dynamic = "force-dynamic";

const CACHE = "public, max-age=60, s-maxage=60";

// Strong: the same tag means the same bytes. The app version is part of it because a deploy can
// change the output (the sanitizer's allowlist) without any row changing.
function etagOf(fingerprint: string, version: string): string {
  const hash = createHash("sha256").update(`${version}\n${fingerprint}`).digest("base64url");
  return `"${hash.slice(0, 32)}"`;
}

// If-None-Match is a list, and a cache may have weakened the tag (W/) on the way.
function matches(header: string | null, etag: string): boolean {
  if (!header) return false;
  return header
    .split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""))
    .some((tag) => tag === etag || tag === "*");
}

export async function GET(request: Request) {
  try {
    const { fingerprint, json } = await readPublic(db());
    const headers = {
      etag: etagOf(fingerprint, env().APP_VERSION),
      "cache-control": CACHE,
      "x-content-type-options": "nosniff",
    };
    if (matches(request.headers.get("if-none-match"), headers.etag)) {
      return new Response(null, { status: 304, headers });
    }
    // The string the reader kept, not Response.json(payload): serialising a few hundred kB per
    // request is the cost the memo exists to avoid.
    return new Response(json, { headers: { ...headers, "content-type": "application/json" } });
  } catch (err) {
    console.error(
      JSON.stringify({ at: "public", error: err instanceof Error ? err.message : String(err) }),
    );
    // Not an empty list: the site's build must fail rather than publish a blog with no posts.
    return Response.json(
      { error: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } },
    );
  }
}
