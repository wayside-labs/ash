// Pure on purpose: the upload handler only orchestrates, and the tests need neither sharp nor a
// real File.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGE_WIDTH = 1600;
// The byte cap does not bound memory: a few hundred bytes of PNG can declare a canvas of
// gigabytes. 50 megapixels fits a current phone camera and decodes in about 200 MB.
export const MAX_IMAGE_PIXELS = 50_000_000;

// Names as sharp's metadata().format reports them. The check takes the decoded format, never
// file.type: that one is whatever the client declared.
const ACCEPTED_FORMATS: readonly string[] = ["jpeg", "png", "webp"];

export type ImageCheck = { ok: true } | { ok: false; error: string };

export function validateImage(image: { format: string | undefined; size: number }): ImageCheck {
  if (!image.format || !ACCEPTED_FORMATS.includes(image.format)) {
    return { ok: false, error: "Use JPG, PNG ou WebP" };
  }
  if (image.size <= 0) return { ok: false, error: "Arquivo vazio" };
  if (image.size > MAX_IMAGE_BYTES) return { ok: false, error: "Imagem até 5MB" };
  return { ok: true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// Relative to UPLOADS_DIR. Both parts become names on disk and the post id arrives from the
// client, so anything that is not a uuid throws instead of being joined into a path. The
// extension is fixed: every upload is re-encoded to WebP. There is no folder for "no post yet":
// the post is created before the editor opens, so an image always belongs to one.
export function buildPostImagePath(postId: string, name: string): string {
  // typeof first: RegExp.test coerces, and a stray null must not become the string "null".
  if (typeof postId !== "string" || !UUID.test(postId)) throw new Error("post id is not a uuid");
  if (!UUID.test(name)) throw new Error("image name is not a uuid");
  return `posts/${postId}/${name}.webp`;
}

// An author's photo. Same rules as a post image, in a folder of its own: the id is checked the
// same way and the name is always ours.
export function buildAuthorImagePath(authorId: string, name: string): string {
  if (typeof authorId !== "string" || !UUID.test(authorId)) throw new Error("author id is not a uuid");
  if (!UUID.test(name)) throw new Error("image name is not a uuid");
  return `autores/${authorId}/${name}.webp`;
}

// A face on a byline is drawn small: it has no use for the 1600 px of a post image.
export const MAX_AVATAR_WIDTH = 512;

// Stored root-relative so the same row works on the studio host and on the public one.
export function mediaUrl(path: string): string {
  return `/media/${path}`;
}

// The only image addresses a post may carry (body and cover). An image from anywhere else would
// be a request to a third party on every page view. Segments must start with a letter or digit,
// which rules out ".", ".." and empty segments; "%" and "\" are simply not in the alphabet.
const MEDIA_PATH = /^\/media(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;

export function isMediaPath(value: string): boolean {
  return MEDIA_PATH.test(value) && !value.includes("..");
}
