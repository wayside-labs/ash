import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
// A static import: the wrapper is a few lines of JavaScript, and its binary only starts when an
// index is created, which never happens with the blog off.
import * as pagefind from "pagefind";

// The search index (decision 9): Pagefind reads the pages the build just wrote and makes one
// index per language (it goes by <html lang>), which the search box loads from /pagefind/ on
// first use. Only post pages are indexed: they are the ones whose <article> carries
// data-pagefind-body, and the glob never leaves the two blog folders.

const OUT = "pagefind";
const POSTS = "{blog,pt/blog}/**/*.html";
// Pagefind also emits its own ready-made interfaces (script and stylesheet). The site draws its
// own search box, so those files are not shipped.
const INTERFACE = /^pagefind-(?:ui|modular-ui|component-ui|highlight)\./;

// Returns how many pages were indexed and how many files were written under <out>/pagefind/.
export async function writeSearchIndex(outDir: string): Promise<{ pages: number; files: number }> {
  try {
    const { index, errors } = await pagefind.createIndex({});
    if (!index) throw new Error(errors.join("; ") || "no index");
    const added = await index.addDirectory({ path: outDir, glob: POSTS });
    if (added.errors.length > 0) throw new Error(added.errors.join("; "));
    const { files, errors: fileErrors } = await index.getFiles();
    if (fileErrors.length > 0) throw new Error(fileErrors.join("; "));

    const root = resolve(outDir, OUT);
    let count = 0;
    for (const file of files) {
      if (INTERFACE.test(file.path)) continue;
      const target = resolve(root, file.path);
      if (!target.startsWith(root + sep)) throw new Error(`${file.path} does not stay under ${OUT}/`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, file.content);
      count += 1;
    }
    // One fragment per indexed page. (Pagefind's own page_count is every file it looked at.)
    return { pages: files.filter((file) => file.path.startsWith("fragment/")).length, files: count };
  } catch (err) {
    throw new Error(`blog search: ${(err as Error).message}`);
  } finally {
    await pagefind.close();
  }
}
