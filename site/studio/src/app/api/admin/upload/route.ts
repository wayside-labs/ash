// A route handler and not a server action: actions cap the body at 1 MB.
// /api/admin/ is not a public prefix (lib/hosts.ts), so on the public host the proxy answers 404
// before this runs; requireAdmin() is still the first statement, as in every admin entry point.
import { BlogError, NotFoundError, isUuid } from "@/blog/errors";
import { MAX_IMAGE_BYTES } from "@/blog/lib/image-rules";
import { ImageTooLargeError, storeAuthorAvatar, storePostImage } from "@/blog/upload";
import { db } from "@/db/client";
import { requireAdmin } from "@/lib/admin";
import { env } from "@/lib/env";
import { refuseCrossSite } from "@/lib/same-origin";

// Room for the multipart envelope (boundaries, part headers, the post_id field).
const MAX_REQUEST_BYTES = MAX_IMAGE_BYTES + 64 * 1024;

const answer = (status: number, body: Record<string, unknown>) =>
  Response.json(body, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
const refuse = (status: number, error: string) => answer(status, { ok: false, error });

export async function POST(request: Request) {
  const { email } = await requireAdmin();
  const refused = refuseCrossSite(request);
  if (refused) return refused;

  // An early exit, not the gate. A declared size over the cap is refused before a byte is read.
  // A request with no Content-Length (chunked) says nothing about its size, so it is not treated
  // as small: it goes on, and file.size below decides. Before this handler runs, the proxy has
  // already stopped buffering at proxyClientMaxBodySize (next.config.ts), whatever was declared.
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared)) return refuse(400, "Pedido inválido.");
    if (Number(declared) > MAX_REQUEST_BYTES) return refuse(413, "Imagem até 5MB");
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    // Not multipart, or multipart cut short: a body over the proxy's limit arrives truncated,
    // without its closing boundary, and fails to parse here. Nothing was stored.
    return refuse(400, "Não foi possível ler o envio: imagem grande demais ou formulário inválido.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) return refuse(400, "Nenhum arquivo enviado.");
  // The real gate: the size of what actually arrived, before any decoding.
  if (file.size > MAX_IMAGE_BYTES) return refuse(413, "Imagem até 5MB");
  // Mandatory: an image belongs to a row that already exists, a post (post_id) or, for an
  // avatar, an author (author_id). Exactly one of the two: with neither, the request is held to
  // the post rule, so leaving author_id out never relaxes anything. Missing, empty or not a uuid
  // is a malformed request (400); a well-formed id of no row is the 404 below.
  const postId = form.get("post_id");
  const authorId = form.get("author_id");
  if (postId !== null && authorId !== null) {
    return refuse(400, "Envie a imagem para um post ou para um autor, não para os dois.");
  }
  if (authorId !== null && !isUuid(authorId)) return refuse(400, "Autor inválido.");
  if (authorId === null && !isUuid(postId)) return refuse(400, "Post inválido.");

  try {
    const shared = {
      bytes: new Uint8Array(await file.arrayBuffer()),
      actor: email,
      uploadsDir: env().UPLOADS_DIR,
    };
    const stored = isUuid(authorId)
      ? await storeAuthorAvatar(db(), { ...shared, authorId })
      : await storePostImage(db(), { ...shared, postId: postId as string });
    return answer(200, { ok: true, ...stored });
  } catch (err) {
    // Only what the admin can act on becomes a message; the rest stays a 500 for the logs.
    if (err instanceof ImageTooLargeError) return refuse(413, err.message);
    if (err instanceof NotFoundError) return refuse(404, err.message);
    if (err instanceof BlogError) return refuse(400, err.message);
    throw err;
  }
}
