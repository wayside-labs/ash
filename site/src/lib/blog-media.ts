import { dirname, resolve, sep } from "node:path";
import { parseBody } from "./blog-html";
import type { PublicPayload } from "./blog-types";
import { isMediaPath, parseStudioUrl } from "./blog-validate";

// The blog asks no third party for anything, the studio included: every image a post refers to is
// copied into dist/blog-media/ at build time and the pages point there. A path is checked again
// at each step that turns it into a URL or a file name, whatever was checked before.

const MEDIA_PREFIX = "/media/";
const TARGET_DIR = "blog-media";

function assertMediaPath(path: string): void {
  if (typeof path !== "string" || !isMediaPath(path)) {
    throw new Error(`blog media: ${JSON.stringify(String(path).slice(0, 120))} is not a /media/ path`);
  }
}

// Relative to the build output: "/media/posts/a/b.webp" -> "blog-media/posts/a/b.webp".
export function mediaTarget(path: string): string {
  assertMediaPath(path);
  return `${TARGET_DIR}/${path.slice(MEDIA_PREFIX.length)}`;
}

// What a page puts in src.
export const mediaHref = (path: string): string => `/${mediaTarget(path)}`;

// Every /media/ path the pages will need: bodies (images and links, read from the parsed body,
// never by pattern: an image whose alt contains "<" is an image all the same), covers, avatars.
// Unique and sorted. A body outside the studio's allowlist throws here too, naming the post.
export function collectMedia(payload: PublicPayload): string[] {
  const paths = new Set<string>();
  for (const post of payload.posts) {
    try {
      if (post.coverUrl !== null) {
        assertMediaPath(post.coverUrl);
        paths.add(post.coverUrl);
      }
      for (const path of parseBody(post.html).media) paths.add(path);
    } catch (err) {
      throw new Error(`blog media: post ${post.lang}/${post.slug}: ${(err as Error).message}`);
    }
  }
  for (const author of payload.authors) {
    if (author.avatarUrl === null) continue;
    assertMediaPath(author.avatarUrl);
    paths.add(author.avatarUrl);
  }
  return [...paths].sort();
}

export type MediaFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface DownloadOptions {
  paths: readonly string[];
  // The studio's public origin, or anything local when `fetch` is fixtureMediaFetch.
  baseUrl: string;
  // The build output; files land in <outDir>/blog-media/.
  outDir: string;
  fetch: MediaFetch;
  writeFile: (path: string, bytes: Uint8Array) => Promise<unknown>;
  mkdir: (path: string) => Promise<unknown>;
  concurrency?: number;
  maxBytes?: number;
  timeoutMs?: number;
}

// The studio's upload cap. What it serves was re-encoded to WebP and is smaller.
const MAX_BYTES = 5 * 1024 * 1024;

const isWebp = (b: Uint8Array): boolean =>
  b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
  b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50;

// Throws on the first image that cannot be fetched, naming its path: a post with a missing image
// must not be published. Returns the files written, relative to outDir.
export async function downloadMedia(opts: DownloadOptions): Promise<string[]> {
  const { concurrency = 4, maxBytes = MAX_BYTES, timeoutMs = 30_000 } = opts;
  const base = parseStudioUrl(opts.baseUrl, "blog media base");
  const root = resolve(opts.outDir, TARGET_DIR);

  // Everything is checked before the first request, so a bad path writes nothing at all.
  const jobs = [...new Set(opts.paths)].map((path) => {
    const target = mediaTarget(path);
    const url = new URL(path, base);
    const file = resolve(opts.outDir, target);
    if (url.origin !== base.origin || url.pathname !== path || !file.startsWith(root + sep)) {
      throw new Error(`blog media: ${path} does not stay under /media/`);
    }
    return { path, target, url: url.href, file };
  });

  const one = async (job: (typeof jobs)[number]): Promise<void> => {
    const res = await opts.fetch(job.url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    if (res.status !== 200) throw new Error(`answered ${res.status}`);
    const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
    if (type !== "image/webp") throw new Error("content-type is not image/webp");
    const tooLarge = `larger than ${maxBytes} bytes`;
    if (Number(res.headers.get("content-length") ?? 0) > maxBytes) throw new Error(tooLarge);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error(tooLarge);
    if (!isWebp(bytes)) throw new Error("the body is not a WebP image");
    await opts.mkdir(dirname(job.file));
    await opts.writeFile(job.file, bytes);
  };

  let next = 0;
  let failed = false;
  const worker = async (): Promise<void> => {
    while (!failed && next < jobs.length) {
      const job = jobs[next++] as (typeof jobs)[number];
      try {
        await one(job);
      } catch (err) {
        failed = true;
        const timedOut = (err as Error)?.name === "TimeoutError";
        throw new Error(`blog media: ${job.path}: ${timedOut ? `no answer in ${timeoutMs} ms` : (err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
  return jobs.map((job) => job.target).sort();
}

// A `fetch` for downloadMedia that answers from a folder laid out like /media/. Fixture mode uses
// it with tests/fixtures/blog-media, so the fixture's images pass the same checks as real ones.
export function fixtureMediaFetch(opts: { dir: string; readFile: (path: string) => Promise<Uint8Array> }): MediaFetch {
  return async (url) => {
    const path = new URL(url).pathname;
    assertMediaPath(path);
    let bytes: Uint8Array;
    try {
      bytes = await opts.readFile(resolve(opts.dir, path.slice(MEDIA_PREFIX.length)));
    } catch {
      return new Response(null, { status: 404 });
    }
    // The cast is for TypeScript's typed-array generics (a Buffer is "ArrayBufferLike"); at run
    // time any Uint8Array is a valid body.
    return new Response(bytes as BodyInit, { status: 200, headers: { "content-type": "image/webp" } });
  };
}
