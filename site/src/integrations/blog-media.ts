import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { collectMedia, downloadMedia, fixtureMediaFetch, type MediaFetch } from "../lib/blog-media";
import { OG_HEIGHT, OG_WIDTH, ogJobs } from "../lib/blog-og";
import { blogApiUrl } from "../lib/blog-source";
import type { PublicPayload } from "../lib/blog-types";

// Copies every image the payload refers to into <out>/blog-media/ and writes a JPEG of each cover
// for og:image. The pages already point there (mediaHref, ogImageHref), so an image that cannot
// be fetched or converted fails the build: a post must not ship with a hole in it.

const FIXTURE_MEDIA = "tests/fixtures/blog-media";

// The little of sharp this file uses. sharp is a devDependency pinned to the version Astro
// itself resolves, so there is one copy in node_modules and its binary is the one CI installs.
type Sharp = (input: string) => {
  resize(width: number, height: number, options: { fit: "cover" }): ReturnType<Sharp>;
  jpeg(options: { quality: number; mozjpeg: boolean }): ReturnType<Sharp>;
  toFile(path: string): Promise<unknown>;
};

// require and not import(): this file is loaded through the config's Vite runner, which is
// already closed when the build's last hook runs, and a dynamic import would go through it.
async function loadSharp(): Promise<Sharp> {
  try {
    return createRequire(import.meta.url)("sharp") as Sharp;
  } catch (err) {
    throw new Error(`blog media: sharp could not be loaded to write the og:image files: ${(err as Error).message}`);
  }
}

// Returns how many images and how many og:image files were written.
export async function copyBlogMedia(payload: PublicPayload, mode: "api" | "fixture", outDir: string): Promise<{ images: number; og: number }> {
  // Fixture mode answers from the repository with the same checks a real download gets; its base
  // URL is never contacted.
  const source: { baseUrl: string; fetch: MediaFetch } = mode === "api"
    ? { baseUrl: blogApiUrl(process.env).origin, fetch: (url, init) => fetch(url, init) }
    : { baseUrl: "http://127.0.0.1/", fetch: fixtureMediaFetch({ dir: resolve(FIXTURE_MEDIA), readFile: (path) => readFile(path) }) };

  const written = await downloadMedia({
    paths: collectMedia(payload),
    outDir,
    ...source,
    writeFile: (path, bytes) => writeFile(path, bytes),
    mkdir: (path) => mkdir(path, { recursive: true }),
  });

  const jobs = ogJobs(payload);
  if (jobs.length > 0) {
    const sharp = await loadSharp();
    for (const job of jobs) {
      try {
        await sharp(resolve(outDir, job.source))
          .resize(OG_WIDTH, OG_HEIGHT, { fit: "cover" })
          .jpeg({ quality: 84, mozjpeg: true })
          .toFile(resolve(outDir, job.target));
      } catch (err) {
        throw new Error(`blog media: ${job.target}: ${(err as Error).message}`);
      }
    }
  }
  return { images: written.length, og: jobs.length };
}
