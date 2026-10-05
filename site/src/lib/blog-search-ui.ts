// The browser half of the blog's search box (components/blog/SearchBox.astro). Touches the DOM,
// like motion.ts; the part that turns an excerpt into safe pieces is pure and tested.

import { decodeEntities } from "./blog-text";

const MAX_RESULTS = 8;

export type ExcerptPiece = { text: string; mark: boolean };

// Pagefind hands an excerpt as HTML: the page's text with entities escaped and the matched words
// wrapped in <mark>. Cut at those two tags and nothing else, so whatever else is in there
// (a title that talks about <script>, an entity) stays text. `decode` turns "&lt;" back into "<"
// for display; the result is only ever written with textContent.
export function excerptPieces(excerpt: string, decode: (html: string) => string): ExcerptPiece[] {
  const pieces: ExcerptPiece[] = [];
  let mark = false;
  for (const part of excerpt.split(/(<mark>|<\/mark>)/)) {
    if (part === "<mark>") mark = true;
    else if (part === "</mark>") mark = false;
    else if (part) pieces.push({ text: decode(part), mark });
  }
  return pieces;
}

// A result may only lead to a page of this site: one slash at the start, and no backslash
// anywhere (browsers read "/\host" as "//host", another site).
export const isLocalPath = (url: unknown): url is string =>
  typeof url === "string" && url.startsWith("/") && !url.startsWith("//") && !url.includes("\\");

// The address to import on the nth try. A browser remembers a module that failed to load and
// answers the same address with the same failure, so a retry needs an address it has not seen.
export const importUrl = (src: string, attempt: number): string => (attempt === 0 ? src : `${src}?retry=${attempt}`);

// "1 result" / "3 results", from the copy's two sentences.
export const countText = (count: number, one: string, other: string): string =>
  (count === 1 ? one : other).replace("{count}", String(count));

interface PagefindResult { url?: string; excerpt?: string; meta?: { title?: string } }
interface Pagefind {
  init?: () => Promise<void>;
  debouncedSearch: (query: string, options?: object, wait?: number) => Promise<{ results: Array<{ data: () => Promise<PagefindResult> }> } | null>;
}

// decodeEntities (blog-text.ts) is plain string work: no parser sees the text, so nothing in it
// can become an element, and its spaces stay where they are.

export function initSearch(root: HTMLElement): void {
  const form = root.querySelector<HTMLFormElement>("[data-search-form]");
  const input = root.querySelector<HTMLInputElement>("input[type=search]");
  const status = root.querySelector<HTMLElement>("[data-search-status]");
  const list = root.querySelector<HTMLUListElement>("[data-search-results]");
  const src = root.dataset.pagefind;
  if (form && input && status && list && src) wire(root, form, input, status, list, src);
}

function wire(root: HTMLElement, form: HTMLFormElement, input: HTMLInputElement, status: HTMLElement, list: HTMLUListElement, src: string): void {
  const say = (text: string) => { status.textContent = text; };
  const links = () => [...list.querySelectorAll<HTMLAnchorElement>("a")];

  // The library and the index are fetched the first time the field is used, once. The import
  // itself is the page's own (SearchBox declares window.ashImport outside the bundle).
  const importer = (window as unknown as { ashImport?: (url: string) => Promise<Pagefind> }).ashImport;
  // A load that fails (the file did not arrive) is forgotten, so the next keystroke or focus
  // tries again instead of answering "not available" until the page is reloaded.
  let loading: Promise<Pagefind> | undefined;
  let attempts = 0;
  const load = (): Promise<Pagefind> =>
    (loading ??= (importer ? importer(importUrl(src, attempts)) : Promise.reject(new Error("no importer")))
      .then(async (api) => { await api.init?.(); return api; })
      .catch((err: unknown) => { loading = undefined; attempts += 1; throw err; }));

  function show(results: PagefindResult[], query: string): void {
    list.replaceChildren();
    for (const result of results) {
      if (!isLocalPath(result.url)) continue;
      const link = document.createElement("a");
      link.href = result.url;
      const title = document.createElement("span");
      title.className = "t";
      title.textContent = result.meta?.title ?? result.url;
      const excerpt = document.createElement("span");
      excerpt.className = "e";
      for (const piece of excerptPieces(result.excerpt ?? "", decodeEntities)) {
        const node = piece.mark ? document.createElement("mark") : document.createTextNode(piece.text);
        if (piece.mark) node.textContent = piece.text;
        excerpt.append(node);
      }
      link.append(title, excerpt);
      const item = document.createElement("li");
      item.append(link);
      list.append(item);
    }
    const count = list.children.length;
    list.hidden = count === 0;
    // The status line is what a screen reader hears: how many results, or that there are none.
    say(count === 0
      ? (root.dataset.none ?? "").replace("{query}", `“${query}”`)
      : countText(count, root.dataset.one ?? "", root.dataset.other ?? ""));
  }

  async function search(): Promise<void> {
    const query = input.value.trim();
    if (!query) { list.replaceChildren(); list.hidden = true; say(root.dataset.hint ?? ""); return; }
    try {
      if (!loading) say(root.dataset.loading ?? "");
      const api = await load();
      const found = await api.debouncedSearch(query, {}, 180);
      // null: a newer keystroke took over, and its answer is the one to show.
      if (found === null) return;
      const results = await Promise.all(found.results.slice(0, MAX_RESULTS).map((r) => r.data()));
      if (input.value.trim() === query) show(results, query);
    } catch {
      list.replaceChildren();
      list.hidden = true;
      say(root.dataset.failed ?? "");
    }
  }

  input.addEventListener("focus", () => { void load().catch(() => {}); if (!input.value.trim()) say(root.dataset.hint ?? ""); });
  input.addEventListener("input", () => { void search(); });
  // Enter goes to the first result: the list is already the answer to what was typed.
  form.addEventListener("submit", (event) => { event.preventDefault(); links()[0]?.click(); });

  root.addEventListener("keydown", (event) => {
    const all = links();
    const at = all.indexOf(document.activeElement as HTMLAnchorElement);
    if (event.key === "ArrowDown" && all.length > 0) {
      event.preventDefault();
      (all[Math.min(at + 1, all.length - 1)] as HTMLAnchorElement).focus();
    } else if (event.key === "ArrowUp" && at >= 0) {
      event.preventDefault();
      if (at === 0) input.focus(); else (all[at - 1] as HTMLAnchorElement).focus();
    } else if (event.key === "Escape") {
      input.value = "";
      input.focus();
      void search();
    }
  });
}
