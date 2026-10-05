import { fileURLToPath } from "node:url";
import type { AstroIntegration } from "astro";
import { loadBlog } from "../lib/blog-source";
import { emptyIndexPaths } from "../lib/blog-views";
import { copyBlogMedia } from "./blog-media";
import { writeSearchIndex } from "./blog-search";

// What the blog needs from the build besides its pages: the images, the og:image files and the
// search index, all written after the pages; and, before them, which blog pages the sitemap
// must leave out. With the blog off none of this runs and nothing is written.

// Filled when the build starts, read by the sitemap's filter when it ends (astro.config.mjs).
const unlisted = new Set<string>();

// The index of a language with no post: it exists, it is noindex, and it is not in the sitemap.
export const isUnlistedBlogPath = (pathname: string): boolean => unlisted.has(pathname.endsWith("/") ? pathname : `${pathname}/`);

export function blog(): AstroIntegration {
  return {
    name: "ash:blog",
    hooks: {
      "astro:build:start": async () => {
        unlisted.clear();
        const load = await loadBlog({ env: process.env });
        if (load.mode !== "off") for (const path of emptyIndexPaths(load.payload)) unlisted.add(path);
      },
      "astro:build:done": async ({ dir, logger }) => {
        const load = await loadBlog({ env: process.env });
        if (load.mode === "off") return;
        const outDir = fileURLToPath(dir);
        const media = await copyBlogMedia(load.payload, load.mode, outDir);
        logger.info(`${media.images} image(s) and ${media.og} og:image file(s) in blog-media/ (source: ${load.mode})`);
        // With no post there is no page to index, and Pagefind would fall back to indexing
        // everything it finds.
        if (load.payload.posts.length === 0) return;
        const search = await writeSearchIndex(outDir);
        logger.info(`search: ${search.pages} post page(s) indexed, ${search.files} file(s) in pagefind/`);
      },
    },
  };
}
