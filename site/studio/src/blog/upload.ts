// App only, never the worker: sharp is a native module and the worker bundle (esbuild) cannot
// carry one.
import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { eq } from "drizzle-orm";
import sharp, { type OutputInfo } from "sharp";
import type { Db } from "@/db/client";
import { blogAuthors, blogPosts } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { BlogError, NotFoundError, ValidationError, isUuid } from "./errors";
import {
  MAX_AVATAR_WIDTH,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_IMAGE_WIDTH,
  buildAuthorImagePath,
  buildPostImagePath,
  mediaUrl,
  validateImage,
} from "./lib/image-rules";

export class ImageTooLargeError extends BlogError {
  constructor() {
    super("Imagem até 5MB");
  }
}

export type StoredImage = { url: string; width: number; height: number; bytes: number };

// `postId` must be the id of an existing post. The editor only opens on a post that was already
// created, so there is no "not saved yet" case, and no image without an owner to clean up later.
//
// Nothing of the upload is trusted: no file name, no declared type. The format comes from the
// decoder, and what is stored is always a fresh WebP encoded here, so a file that is a valid
// image and something else at once (a polyglot) does not survive either.
export async function storePostImage(
  db: Db,
  input: { bytes: Uint8Array; postId: string; actor: string; uploadsDir: string },
): Promise<StoredImage> {
  // Malformed is a bad request, not a missing post: it never reaches the database (where it
  // would be a cast error) nor the disk.
  if (!isUuid(input.postId)) throw new ValidationError("Post inválido.");
  // A uuid is the same id in either case, and Postgres takes both; the folder name is always
  // lowercase (buildPostImagePath refuses anything else, so the path has one spelling).
  const postId = input.postId.toLowerCase();
  return storeImage(db, input, {
    exists: async () => {
      const rows = await db.select({ id: blogPosts.id }).from(blogPosts).where(eq(blogPosts.id, postId));
      return rows.length > 0;
    },
    missing: "Post não encontrado",
    path: (name) => buildPostImagePath(postId, name),
    maxWidth: MAX_IMAGE_WIDTH,
    audit: { postId },
  });
}

// The photo of an author that already exists. The same pipeline and the same refusals as a post
// image, in a folder of its own (autores/<id>/), so an avatar never needs a post to hang from
// and a post image never needs less than a post. The caller writes the returned url into the
// author's row; an upload that is never saved leaves a file no row points at, which is the same
// trade a post image makes.
export async function storeAuthorAvatar(
  db: Db,
  input: { bytes: Uint8Array; authorId: string; actor: string; uploadsDir: string },
): Promise<StoredImage> {
  if (!isUuid(input.authorId)) throw new ValidationError("Autor inválido.");
  const authorId = input.authorId.toLowerCase();
  return storeImage(db, input, {
    exists: async () => {
      const rows = await db
        .select({ id: blogAuthors.id })
        .from(blogAuthors)
        .where(eq(blogAuthors.id, authorId));
      return rows.length > 0;
    },
    missing: "Autor não encontrado",
    path: (name) => buildAuthorImagePath(authorId, name),
    maxWidth: MAX_AVATAR_WIDTH,
    audit: { authorId },
  });
}

// Who the image belongs to: the row that must exist, where the file goes and what the audit
// row says. Everything else is the same for every image.
type Owner = {
  exists: () => Promise<boolean>;
  missing: string;
  path: (name: string) => string;
  maxWidth: number;
  audit: Record<string, string>;
};

async function storeImage(
  db: Db,
  input: { bytes: Uint8Array; actor: string; uploadsDir: string },
  owner: Owner,
): Promise<StoredImage> {
  const { bytes, actor, uploadsDir } = input;
  // Size first: the cheapest refusal, and the decoder never sees an oversized file.
  if (bytes.length === 0) throw new ValidationError("Arquivo vazio");
  if (bytes.length > MAX_IMAGE_BYTES) throw new ImageTooLargeError();

  if (!(await owner.exists())) throw new NotFoundError(owner.missing);

  // limitInputPixels makes the decoder itself refuse a canvas over the cap; the explicit check
  // below reads the header only and gives the readable message.
  const image = sharp(bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: "error" });
  let format: string | undefined;
  let pixels = 0;
  try {
    const meta = await image.metadata();
    format = meta.format;
    pixels = (meta.width ?? 0) * (meta.height ?? 0);
  } catch {
    // Not an image sharp can read at all.
    throw new ValidationError("Use JPG, PNG ou WebP");
  }
  const check = validateImage({ format, size: bytes.length });
  if (!check.ok) throw new ValidationError(check.error);
  if (pixels <= 0 || pixels > MAX_IMAGE_PIXELS) {
    throw new ValidationError("Imagem grande demais em pixels (máx. 50 megapixels)");
  }

  let data: Buffer;
  let info: OutputInfo;
  try {
    // rotate() with no angle applies the EXIF orientation, so the pixels are upright before the
    // metadata is dropped. sharp writes no metadata unless asked (no withMetadata/keepExif here):
    // EXIF, GPS, ICC and XMP all stay behind.
    ({ data, info } = await image
      .rotate()
      .resize({ width: owner.maxWidth, withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true }));
  } catch {
    throw new ValidationError("Imagem inválida ou corrompida");
  }

  // The name is ours (a fresh uuid) and the owner's id was checked by the caller; the path
  // builders throw on anything else, so no client string is ever joined into a path.
  const relative = owner.path(randomUUID());
  const absolute = join(uploadsDir, relative);
  await mkdir(dirname(absolute), { recursive: true });
  // wx: never overwrite. A uuid collision is not expected; if it happens it is an error, not a
  // silent replacement of someone's image.
  try {
    await writeFile(absolute, data, { flag: "wx" });
  } catch (err) {
    // A full disk leaves a truncated file behind, which /media would serve as an image. EEXIST
    // is the one failure where the file is not ours to remove.
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") await unlink(absolute).catch(() => {});
    throw err;
  }

  const stored = { url: mediaUrl(relative), width: info.width, height: info.height, bytes: data.length };
  try {
    await logAudit(db, {
      event: "blog.image_uploaded",
      actor,
      payload: { ...owner.audit, ...stored },
    });
  } catch (err) {
    // No audit row, no file: an image nobody can account for must not stay on the public host.
    await unlink(absolute).catch(() => {});
    throw err;
  }
  return stored;
}
