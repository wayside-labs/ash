// The browser's side of POST /api/admin/upload. A same-origin fetch: the browser sends
// Sec-Fetch-Site: same-origin and the Access cookie by itself, which is what the route's
// refuseCrossSite and requireAdmin look at.
import { MAX_IMAGE_BYTES, isMediaPath } from "@/blog/lib/image-rules";

// Who the image belongs to. The route takes exactly one of the two.
export type ImageOwner = { postId: string } | { authorId: string };

export type UploadedImage = { url: string; width: number; height: number };
export type UploadResult =
  | ({ ok: true } & UploadedImage)
  // `cancelled` when the caller's signal stopped it: said differently from a failure.
  | { ok: false; error: string; cancelled?: true };

export type UploadOptions = {
  // The dialog's "Cancelar envio".
  signal?: AbortSignal;
  timeoutMs?: number;
  fetcher?: typeof fetch;
};

// A request that never answers would leave the dialog busy for good (it does not close while
// uploading). Five megabytes go up in far less than this on any connection worth waiting for.
export const UPLOAD_TIMEOUT_MS = 60_000;

const TOO_LARGE = "Imagem até 5MB";
const TIMED_OUT =
  "O envio demorou mais de um minuto e foi interrompido. Confira a conexão e tente de novo.";
const CANCELLED = "Envio cancelado.";
const UNREACHABLE = "Não foi possível falar com o servidor. Confira a conexão e tente de novo.";

// Never throws: every failure comes back as a message for the dialog. The server's own message
// is shown as it comes; the fallbacks are for answers that are not ours (a proxy's 413 page, a
// dropped connection).
export async function uploadImage(
  file: File,
  owner: ImageOwner,
  options: UploadOptions = {},
): Promise<UploadResult> {
  const { signal, timeoutMs = UPLOAD_TIMEOUT_MS, fetcher = fetch } = options;
  // The server checks again; this only spares sending megabytes to be refused.
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: TOO_LARGE };
  if (file.size === 0) return { ok: false, error: "Arquivo vazio" };
  if (signal?.aborted) return { ok: false, error: CANCELLED, cancelled: true };

  const form = new FormData();
  form.set("file", file);
  if ("postId" in owner) form.set("post_id", owner.postId);
  else form.set("author_id", owner.authorId);

  // One controller for both ways of stopping: the caller's cancel and the clock.
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel);
  const stopped = (): UploadResult | null => {
    if (timedOut) return { ok: false, error: TIMED_OUT };
    if (signal?.aborted) return { ok: false, error: CANCELLED, cancelled: true };
    return null;
  };

  try {
    let response: Response;
    try {
      response = await fetcher("/api/admin/upload", {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
    } catch {
      return stopped() ?? { ok: false, error: UNREACHABLE };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // Stopped while the answer was still arriving, or an answer that is not JSON.
      const why = stopped();
      if (why) return why;
      body = null;
    }
    const answer = (body ?? {}) as {
      ok?: unknown;
      error?: unknown;
      url?: unknown;
      width?: unknown;
      height?: unknown;
    };

    if (!response.ok || answer.ok !== true) {
      if (typeof answer.error === "string" && answer.error) return { ok: false, error: answer.error };
      if (response.status === 413) return { ok: false, error: TOO_LARGE };
      return { ok: false, error: `Não foi possível enviar a imagem (erro ${response.status}).` };
    }
    // Only an address of our own /media is ever put into a post, whatever answered.
    if (typeof answer.url !== "string" || !isMediaPath(answer.url)) {
      return { ok: false, error: "O servidor respondeu sem o endereço da imagem. Tente de novo." };
    }
    return {
      ok: true,
      url: answer.url,
      width: typeof answer.width === "number" ? answer.width : 0,
      height: typeof answer.height === "number" ? answer.height : 0,
    };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
