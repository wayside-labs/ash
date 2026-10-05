// Public on purpose (lib/hosts.ts lists /media/): these are the images of published posts, and
// of drafts too, whose address is an unguessable uuid. No requireAdmin() here.
import { readMedia } from "@/blog/media";
import { env } from "@/lib/env";

// The name is a fresh uuid per upload and a file is never rewritten, so a year is safe.
const FOUND = {
  "content-type": "image/webp",
  "x-content-type-options": "nosniff",
  "cache-control": "public, max-age=31536000, immutable",
};
// no-store: a 404 cached at the edge would outlive the upload that fixes it.
const MISSING = {
  "content-type": "text/plain; charset=utf-8",
  "x-content-type-options": "nosniff",
  "cache-control": "no-store",
};

export async function GET(_request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const bytes = await readMedia(env().UPLOADS_DIR, path);
  if (!bytes) return new Response("Not found", { status: 404, headers: MISSING });
  return new Response(new Uint8Array(bytes), {
    headers: { ...FOUND, "content-length": String(bytes.length) },
  });
}
