import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

// The other specs run against whatever is in dist/ (a fixture build). This one makes its own
// builds, into test-results/ (ignored by git), to prove what the served build cannot: the site
// with the blog off (production's default until the studio is live), a blog with posts in one
// language only, and the contact block with and without a channel configured.
// No browser: the assertions read the files and the build's log. One build at a time, because
// astro keeps its intermediate files in one folder (.astro/).
test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const run = promisify(execFile);
const NO_CHANNEL = { PUBLIC_BOOKING_URL: "", PUBLIC_WHATSAPP: "", PUBLIC_CONTACT_EMAIL: "" };

// Resolves with the build's output, or with "FAILED" in front of it when astro exits non-zero.
async function build(outDir: string, env: Record<string, string | undefined>): Promise<string> {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...process.env, BLOG_FIXTURE_PATH: undefined, ...env })) if (value !== undefined) merged[key] = value;
  try {
    const { stdout, stderr } = await run(process.execPath, ["node_modules/astro/bin/astro.mjs", "build", "--outDir", outDir], { env: merged, maxBuffer: 16 * 1024 * 1024 });
    return `${stdout}\n${stderr}`;
  } catch (err) {
    const failed = err as { stdout?: string; stderr?: string; message: string };
    return `FAILED\n${failed.stdout ?? ""}\n${failed.stderr ?? ""}\n${failed.message}`;
  }
}

const read = (...parts: string[]): string => readFileSync(path.join(...parts), "utf8");
const out = (name: string): string => path.join("test-results", name);

test("with BLOG_SOURCE unset the build has no blog, no search and no link to either", async () => {
  const dir = out("dist-blog-off");
  const log = await build(dir, { BLOG_SOURCE: undefined, BLOG_API_URL: undefined });
  expect(log).not.toContain("FAILED");
  expect(log).not.toContain("/blog/");

  for (const gone of ["blog", "blog-media", "pagefind", path.join("pt", "blog")]) expect(existsSync(path.join(dir, gone)), gone).toBe(false);
  for (const page of ["index.html", path.join("pt", "index.html"), path.join("privacy", "index.html"), path.join("pt", "privacidade", "index.html"), path.join("pitch", "index.html"), path.join("investor", "index.html")]) {
    const html = read(dir, page);
    expect(html, page).not.toMatch(/href="\/(pt\/)?blog\//);
    expect(html, page).not.toContain(">Blog<");
    expect(html, page).not.toContain("application/rss+xml");
    expect(html, page).not.toContain("pagefind");
    expect(html, page).not.toContain('class="links with-blog"');
  }
  expect(read(dir, "sitemap-0.xml")).not.toContain("/blog");

  // The pages that existed before the blog keep the head they had.
  const home = read(dir, "index.html");
  expect(home).toContain('<link rel="canonical" href="https://ash.app.br/">');
  expect(home).toContain('<link rel="alternate" hreflang="pt-BR" href="https://ash.app.br/pt/">');
  expect(home).toContain('<link rel="alternate" hreflang="x-default" href="https://ash.app.br/">');
  expect(home).toContain('<meta property="og:type" content="website">');
  expect(home).toContain('<meta property="og:image" content="https://ash.app.br/og.png">');
  expect(home).not.toContain("article:published_time");
  expect(home).toContain('href="#how"');
  const pitch = read(dir, "pt", "pitch", "index.html");
  expect(pitch).toContain('<meta name="robots" content="noindex, nofollow">');
  expect(pitch).toContain('<link rel="alternate" hreflang="en" href="https://ash.app.br/pitch/">');
  expect(read(dir, "pt", "investidor", "index.html")).toContain('<link rel="alternate" hreflang="en" href="https://ash.app.br/investor/">');
});

test("with posts in one language only, the other language has a landing page and nothing else", async () => {
  // The fixture, English only, with two spellings of one tag and a tag no URL can carry.
  const payload = JSON.parse(read("tests", "fixtures", "blog-payload.json"));
  payload.posts = payload.posts.filter((p: { lang: string }) => p.lang === "en").map((p: { translationSlug: null; tags: string[]; slug: string }) => ({
    ...p,
    translationSlug: null,
    tags: p.slug === "the-feed" ? ["Writing!", "日本"] : p.tags,
  }));
  mkdirSync("test-results", { recursive: true });
  writeFileSync(out("en-only.json"), JSON.stringify(payload));

  const dir = out("dist-blog-en-only");
  const log = await build(dir, { BLOG_SOURCE: "fixture", BLOG_FIXTURE_PATH: out("en-only.json"), ...NO_CHANNEL });
  expect(log).not.toContain("FAILED");

  // Portuguese: the index exists so the language switch has somewhere to land, and that is all.
  const empty = read(dir, "pt", "blog", "index.html");
  expect(empty).toContain('<meta name="robots" content="noindex, follow">');
  expect(empty).toContain("Nada publicado aqui ainda.");
  expect(empty).not.toMatch(/<link rel="alternate" hreflang=/);
  expect(empty).not.toContain("application/rss+xml");
  expect(empty).not.toContain("rss.xml");
  expect(empty).not.toContain("data-search");
  expect(readdirSync(path.join(dir, "pt", "blog"))).toEqual(["index.html"]);
  // No link to an empty blog from the Portuguese pages; the English ones still have theirs.
  for (const page of [path.join("pt", "index.html"), path.join("pt", "privacidade", "index.html"), path.join("pt", "blog", "index.html")]) {
    expect(read(dir, page), page).not.toContain(">Blog</a>");
  }
  expect(read(dir, "index.html")).toMatch(/<a href="\/blog\/"[^>]*>Blog<\/a>/);

  // English: a full blog that does not advertise the empty one.
  const index = read(dir, "blog", "index.html");
  expect(index).not.toMatch(/<link rel="alternate" hreflang=/);
  expect(index).toContain('type="application/rss+xml"');
  expect(index).not.toContain('name="robots"');
  expect(existsSync(path.join(dir, "blog", "rss.xml"))).toBe(true);
  const sitemap = read(dir, "sitemap-0.xml");
  expect(sitemap).toContain("<loc>https://ash.app.br/blog/</loc>");
  expect(sitemap).not.toContain("/pt/blog");

  // Tags never stop a build: two spellings share one page (and the log says so), and a tag with
  // no Latin letter gets a page under a stable name.
  expect(log).toContain('the en tags "writing" and "Writing!" share the page /tag/writing/');
  expect(read(dir, "blog", "tag", "writing", "index.html")).toContain('data-post="the-feed"');
  expect(readdirSync(path.join(dir, "blog", "tag")).filter((name) => /^t-[0-9a-f]{8}$/.test(name))).toHaveLength(1);
});

test("the contact block is a card with a channel configured, and the newsletter block is nothing", async () => {
  const dir = out("dist-blog-contact");
  const log = await build(dir, { BLOG_SOURCE: "fixture", ...NO_CHANNEL, PUBLIC_CONTACT_EMAIL: "blog-e2e@ash.app.br" });
  expect(log).not.toContain("FAILED");
  expect(log).toContain("og:image file(s) in blog-media/ (source: fixture)");
  expect(log).toMatch(/search: 17 post page\(s\) indexed/);
  expect(log).toContain("{{cta:newsletter}} renders nothing until the newsletter exists (M3)");
  expect(log.match(/cta:newsletter\}\} renders nothing/g)).toHaveLength(1);
  expect(log).not.toContain("{{cta:contato}} renders nothing");

  const html = read(dir, "blog", "every-special-block-in-one-post", "index.html");
  const card = /<aside[^>]*data-shortcode="cta:contato"[^>]*>(.*?)<\/aside>/s.exec(html)?.[1] ?? "";
  expect(card).toContain("Ready to let an agent pay?");
  expect(card).toMatch(/href="mailto:blog-e2e@ash\.app\.br\?subject=Ash%20%E2%80%94%20from%20the%20blog"[^>]*data-channel="email"/);
  expect(card).toContain('rel="noopener noreferrer"');
  expect(html.match(/data-shortcode="cta:contato"/g)).toHaveLength(1);
  expect(html).not.toContain('data-shortcode="cta:newsletter"');
  expect(html).not.toContain("{{");
  // The header's button takes the same filter: with no booking address it is the home's anchor.
  expect(html).toContain('href="/#contact"');
});

test("with no channel configured the contact block renders nothing and the build log names the post", async () => {
  const dir = out("dist-blog-no-contact");
  const log = await build(dir, { BLOG_SOURCE: "fixture", ...NO_CHANNEL });
  expect(log).not.toContain("FAILED");
  expect(log).toContain("post en/every-special-block-in-one-post: {{cta:contato}} renders nothing, no contact channel is configured");
  const html = read(dir, "blog", "every-special-block-in-one-post", "index.html");
  expect(html).not.toContain('data-shortcode="cta:contato"');
  expect(html.match(/data-shortcode="/g)).toHaveLength(2);
});

// 29/09: a placeholder from .env.example went live on every button. Whatever the three variables
// hold, a value that is not real must not reach any page: not as a button, not as printed text.
test("placeholder contact values reach no page of the site or of the blog", async () => {
  const dir = out("dist-blog-placeholder");
  const log = await build(dir, {
    BLOG_SOURCE: "fixture",
    PUBLIC_BOOKING_URL: "https://cal.com/exemplo/20min", PUBLIC_CONTACT_EMAIL: "contato@example.com", PUBLIC_WHATSAPP: "123",
  });
  expect(log).not.toContain("FAILED");
  const pages = (readdirSync(dir, { recursive: true }) as string[]).filter((file) => file.endsWith(".html"));
  expect(pages.length).toBeGreaterThan(50);
  for (const page of pages) {
    const html = read(dir, page);
    expect(html, page).not.toContain("cal.com/exemplo");
    expect(html, page).not.toContain("contato@example.com");
    // (A post's share row links to wa.me with no number; what must not exist is a contact link.)
    expect(html, page).not.toContain("wa.me/123");
  }
  // The home falls back to its own contact section, five times (header, hero, three doors),
  // and that section has neither a button nor an address.
  const home = read(dir, "index.html");
  expect(home.match(/class="btn [^"]*" href="#contact"/g)).toHaveLength(5);
  const closing = /<section class="closing"[^>]*>.*?<\/section>/s.exec(home)?.[0] ?? "";
  expect(closing).toContain("Ready to let an agent pay?");
  expect(closing).not.toMatch(/<a |<code/);
  expect(read(dir, "privacy", "index.html")).toContain('href="/#contact"');
  expect(read(dir, "blog", "every-special-block-in-one-post", "index.html")).not.toContain('data-shortcode="cta:contato"');
});

test("an unknown BLOG_SOURCE stops the build instead of guessing", async () => {
  const dir = out("dist-blog-bad");
  const log = await build(dir, { BLOG_SOURCE: "on" });
  expect(log).toContain("FAILED");
  expect(log).toContain("BLOG_SOURCE must be");
  expect(existsSync(path.join(dir, "index.html"))).toBe(false);
});
