// The public site (the Astro project one folder up) builds its blog from GET /api/public/posts,
// and tests itself against a fixture: ../tests/fixtures/blog-payload.json. Nothing else ties that
// file to what this app really serves, so this suite does: a field added, removed or retyped on
// either side fails here, before a deploy finds out.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { upsertAuthor } from "@/blog/authors";
import { upsertCategory } from "@/blog/categories";
import { isMediaPath } from "@/blog/lib/image-rules";
import { readingTimeMinutes } from "@/blog/lib/reading-time";
import { sanitizePostHtml } from "@/blog/lib/sanitize";
import { KNOWN_SHORTCODES, validateShortcodes } from "@/blog/lib/shortcodes";
import { withToc } from "@/blog/lib/toc";
import { createPost, createTranslation } from "@/blog/posts";
import { type PublicPayload, getPublicPayload } from "@/blog/public";
import { setPostStatus } from "@/blog/status";
import type { Db } from "@/db/client";
import { ACTOR, postInput } from "./helpers/blog";
import { describeDb, freshDb } from "./helpers/db";

const site = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), "utf8");
const fixture = JSON.parse(site("tests/fixtures/blog-payload.json")) as PublicPayload;
const siteTypes = site("src/lib/blog-types.ts");
const siteBody = site("src/lib/blog-body.ts");

type Json = Record<string, unknown>;
const kind = (value: unknown): string => (value === null ? "null" : Array.isArray(value) ? "array" : typeof value);
const keysOf = (value: unknown): string[] => Object.keys(value as Json).sort();

// For a list of objects of one type: every key set seen, and the kinds each key took.
function shape(items: unknown[]): { keys: string[][]; kinds: Record<string, string[]> } {
  const keySets = new Set<string>();
  const kinds: Record<string, Set<string>> = {};
  for (const item of items) {
    keySets.add(JSON.stringify(keysOf(item)));
    for (const [key, value] of Object.entries(item as Json)) (kinds[key] ??= new Set()).add(kind(value));
  }
  return {
    keys: [...keySets].sort().map((k) => JSON.parse(k) as string[]),
    kinds: Object.fromEntries(Object.entries(kinds).map(([key, set]) => [key, [...set].sort()])),
  };
}

// The four object types of the payload, flattened out of it.
function parts(payload: PublicPayload) {
  return {
    root: [payload],
    post: payload.posts,
    toc: payload.posts.flatMap((p) => p.toc),
    postCategory: payload.posts.flatMap((p) => (p.category ? [p.category] : [])),
    postAuthor: payload.posts.flatMap((p) => (p.author ? [p.author] : [])),
    category: payload.categories,
    author: payload.authors,
  };
}

// The fields a type declares in the site's blog-types.ts: one per line, two spaces in.
function declaredKeys(name: string): string[] {
  const block = new RegExp(`export type ${name} = \\{\\n([\\s\\S]*?)\\n\\};`).exec(siteTypes)?.[1];
  if (block === undefined) throw new Error(`blog-types.ts has no "export type ${name} = { ... };"`);
  return [...block.matchAll(/^ {2}([A-Za-z]+)\??:/gm)].map((m) => m[1] as string).sort();
}

describe("a fixture do site contra o que o studio produz (sem banco)", () => {
  it("os tipos do site declaram exatamente os campos que a fixture tem", () => {
    const fx = parts(fixture);
    expect(shape(fx.root).keys).toEqual([declaredKeys("PublicPayload")]);
    expect(shape(fx.post).keys).toEqual([declaredKeys("PublicPost")]);
    expect(shape(fx.toc).keys).toEqual([declaredKeys("TocItem")]);
    expect(shape(fx.category).keys).toEqual([declaredKeys("PublicCategory")]);
    expect(shape(fx.postCategory).keys).toEqual([declaredKeys("PublicCategory")]);
    expect(shape(fx.author).keys).toEqual([declaredKeys("PublicAuthor")]);
    expect(shape(fx.postAuthor).keys).toEqual([["name", "slug"]]);
  });

  it("cada corpo da fixture é algo que o sanitizador e o sumário devolveriam sem mudar", () => {
    for (const post of fixture.posts) {
      const again = withToc(sanitizePostHtml(post.html));
      expect(again.html, post.slug).toBe(post.html);
      expect(again.items, post.slug).toEqual(post.toc);
      expect(readingTimeMinutes(post.html), post.slug).toBe(post.readingMinutes);
      expect(validateShortcodes(post.html), post.slug).toMatchObject({ ok: true });
    }
  });

  it("capas e fotos da fixture passam na regra de caminho do studio; datas no formato de toISOString", () => {
    for (const post of fixture.posts) {
      if (post.coverUrl !== null) expect(isMediaPath(post.coverUrl), post.slug).toBe(true);
      expect(new Date(post.publishedAt).toISOString(), post.slug).toBe(post.publishedAt);
      expect(new Date(post.updatedAt).toISOString(), post.slug).toBe(post.updatedAt);
    }
    for (const author of fixture.authors) {
      if (author.avatarUrl !== null) expect(isMediaPath(author.avatarUrl), author.slug).toBe(true);
    }
  });

  it("a fixture está na ordem em que o studio serve, e só lista categoria e autor em uso", () => {
    const order = [...fixture.posts].sort(
      (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || (a.slug < b.slug ? -1 : 1),
    );
    expect(fixture.posts.map((p) => p.slug)).toEqual(order.map((p) => p.slug));
    const used = (pick: (p: PublicPayload["posts"][number]) => string | undefined) =>
      [...new Set(fixture.posts.flatMap((p) => pick(p) ?? []))].sort();
    expect(fixture.categories.map((c) => c.slug)).toEqual(used((p) => p.category?.slug));
    expect(fixture.authors.map((a) => a.slug)).toEqual(used((p) => p.author?.slug));
  });

  it("o site conhece o mesmo catálogo de blocos especiais", () => {
    const listed = /KNOWN_SHORTCODES = \[([^\]]*)\]/.exec(siteBody)?.[1];
    expect(listed).toBeDefined();
    expect(JSON.parse(`[${listed}]`)).toEqual([...KNOWN_SHORTCODES]);
  });
});

describeDb("a fixture do site contra um payload de verdade", () => {
  let db: Db;
  let close: () => Promise<void>;
  let real: PublicPayload;
  const when = new Date("2099-01-01T12:00:00Z");
  const REVIEWER = "revisora@example.com";

  const publish = async (id: string) => {
    await setPostStatus(db, { id, action: "submit" }, ACTOR, when);
    await setPostStatus(db, { id, action: "approve" }, REVIEWER, when);
    await setPostStatus(db, { id, action: "publish" }, REVIEWER, when);
  };

  beforeAll(async () => {
    ({ db, close } = await freshDb());
    await db.execute(sql`truncate blog_posts, blog_categories, blog_authors, audit_log, jobs cascade`);
    const withPhoto = await upsertAuthor(db, {
      slug: "com-foto", name: "Com Foto", bio_pt: "Bio", bio_en: "Bio", avatar_url: "/media/autores/a/foto.webp",
    }, ACTOR);
    const noPhoto = await upsertAuthor(db, { slug: "sem-foto", name: "Sem Foto" }, ACTOR);
    const category = await upsertCategory(db, { slug: "produto", name_pt: "Produto", name_en: "Product" }, ACTOR);

    // One post with every optional field filled and one with none, so each nullable field shows
    // both of the kinds it can take; plus a translated pair for translationSlug.
    const full = await createPost(db, postInput(withPhoto.id, {
      title: "Post completo de contrato",
      excerpt: "Resumo",
      body_html: "<h2>Seção</h2><p>texto</p><h3>Detalhe</h3><p>mais</p>{{mapa}}",
      category_id: category.id,
      tags: ["solana"],
      featured: true,
      meta_title: "Título de SEO",
      meta_description: "Descrição de SEO",
      cover_url: "/media/posts/a/capa.webp",
      cover_alt: "Capa",
    }), ACTOR);
    const bare = await createPost(db, postInput(noPhoto.id, { title: "Post mínimo de contrato", body_html: "<p>só isso</p>" }), ACTOR);
    const translation = await createTranslation(db, full.id, postInput(withPhoto.id, { lang: "en", title: "The full contract post" }), ACTOR);
    for (const id of [full.id, bare.id, translation.id]) await publish(id);

    real = await getPublicPayload(db);
  });
  afterAll(async () => close());

  it("o payload de verdade tem os três posts e os dois valores de cada campo opcional", () => {
    expect(real.posts).toHaveLength(3);
    expect(real.posts.some((p) => p.translationSlug !== null)).toBe(true);
    expect(real.posts.some((p) => p.category === null)).toBe(true);
    expect(real.authors.map((a) => a.avatarUrl === null).sort()).toEqual([false, true]);
  });

  it("posts, sumário, categorias e autores da fixture têm exatamente as chaves do payload de verdade", () => {
    const fx = parts(fixture);
    const re = parts(real);
    for (const name of Object.keys(re) as Array<keyof typeof re>) {
      expect(shape(fx[name]).keys, name).toEqual(shape(re[name]).keys);
    }
  });

  it("e cada campo assume na fixture os mesmos tipos de valor que assume de verdade", () => {
    const fx = parts(fixture);
    const re = parts(real);
    for (const name of Object.keys(re) as Array<keyof typeof re>) {
      expect(shape(fx[name]).kinds, name).toEqual(shape(re[name]).kinds);
    }
  });

  it("os tipos do site declaram exatamente os campos do payload de verdade", () => {
    const re = parts(real);
    expect(shape(re.root).keys).toEqual([declaredKeys("PublicPayload")]);
    expect(shape(re.post).keys).toEqual([declaredKeys("PublicPost")]);
    expect(shape(re.toc).keys).toEqual([declaredKeys("TocItem")]);
    expect(shape(re.category).keys).toEqual([declaredKeys("PublicCategory")]);
    expect(shape(re.author).keys).toEqual([declaredKeys("PublicAuthor")]);
  });
});
