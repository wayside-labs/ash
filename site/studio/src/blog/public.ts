// The one read that leaves the house: the site fetches this at build time, and anyone can fetch
// it too. Every object below is built field by field. Never spread a row here: a column added to
// the table tomorrow (an e-mail, a note) would become public without anyone deciding it.
//
// THE FIELD CONTRACT, for whoever consumes this JSON:
// - `html` (on a post) is the only field that is HTML. It went through the sanitizer's allowlist
//   and may be inserted as markup.
// - EVERY other string is plain text and must be escaped by the consumer for the place it goes:
//   title, excerpt, tags, meta fields, cover alt, category and author names, bios, and
//   `toc[].text` too (entities are already decoded there, so a heading that talks about
//   "<script>" arrives as the literal characters).
// - A title may legitimately contain "<", "&" or "</script>". Put inside a JSON-LD block or any
//   inline <script>, the string "</script>" closes the element: serialise with "<" escaped as
//   "\u003c", never with a bare JSON.stringify.
// - `coverUrl` and `avatarUrl` are root-relative /media/... paths or null, never another origin.
import { asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { blogAuthors, blogCategories, blogPosts } from "@/db/schema";
import { isMediaPath } from "./lib/image-rules";
import { readingTimeMinutes } from "./lib/reading-time";
import { sanitizePostHtml } from "./lib/sanitize";
import { type TocItem, withToc } from "./lib/toc";

export type PublicCategory = { slug: string; namePt: string; nameEn: string };
export type PublicAuthor = {
  slug: string;
  name: string;
  bioPt: string;
  bioEn: string;
  // /media/... or null.
  avatarUrl: string | null;
};

export type PublicPost = {
  slug: string;
  lang: "pt" | "en";
  // Plain text, like every string here except `html`.
  title: string;
  excerpt: string | null;
  // The only HTML field. Sanitized, with ids on h2/h3. Shortcodes are still {{name}} markers:
  // the site swaps them.
  html: string;
  // `text` is plain text with entities decoded: escape it when rendering.
  toc: TocItem[];
  readingMinutes: number;
  category: PublicCategory | null;
  tags: string[];
  author: { slug: string; name: string } | null;
  // /media/... or null.
  coverUrl: string | null;
  coverAlt: string | null;
  metaTitle: string | null;
  metaDescription: string | null;
  featured: boolean;
  publishedAt: string;
  updatedAt: string;
  // The slug of the same post in the other language, when that one is public too.
  translationSlug: string | null;
};

// Categories and authors are only the ones a served post refers to: an unused category, or an
// author who has only drafts, is not public yet.
export type PublicPayload = {
  posts: PublicPost[];
  categories: PublicCategory[];
  authors: PublicAuthor[];
};

type Log = (entry: Record<string, unknown>) => void;
const toConsole: Log = (entry) => console.error(JSON.stringify(entry));

// Rows also arrive by psql and by restore, so what the schema promised on save is checked again
// on the way out: an address that is not ours is dropped, not served.
const mediaOrNull = (value: string | null) => (value !== null && isMediaPath(value) ? value : null);

export async function getPublicPayload(db: Db, log: Log = toConsole): Promise<PublicPayload> {
  const rows = await db
    .select({
      slug: blogPosts.slug,
      lang: blogPosts.lang,
      translationGroup: blogPosts.translationGroup,
      title: blogPosts.title,
      excerpt: blogPosts.excerpt,
      bodyHtml: blogPosts.bodyHtml,
      tags: blogPosts.tags,
      featured: blogPosts.featured,
      coverUrl: blogPosts.coverUrl,
      coverAlt: blogPosts.coverAlt,
      metaTitle: blogPosts.metaTitle,
      metaDescription: blogPosts.metaDescription,
      publishedAt: blogPosts.publishedAt,
      updatedAt: blogPosts.updatedAt,
      categorySlug: blogCategories.slug,
      categoryNamePt: blogCategories.namePt,
      categoryNameEn: blogCategories.nameEn,
      authorSlug: blogAuthors.slug,
      authorName: blogAuthors.name,
      authorBioPt: blogAuthors.bioPt,
      authorBioEn: blogAuthors.bioEn,
      authorAvatarUrl: blogAuthors.avatarUrl,
    })
    .from(blogPosts)
    .leftJoin(blogCategories, eq(blogCategories.id, blogPosts.categoryId))
    .leftJoin(blogAuthors, eq(blogAuthors.id, blogPosts.authorId))
    // The only filter there is, and it is not optional: no caller can ask for another state.
    .where(eq(blogPosts.status, "publicado"))
    .orderBy(desc(blogPosts.publishedAt), asc(blogPosts.slug));

  const served: Array<{ group: string; post: PublicPost }> = [];
  const categories = new Map<string, PublicCategory>();
  const authors = new Map<string, PublicAuthor>();

  for (const row of rows) {
    let body: { html: string; items: TocItem[] };
    try {
      // Sanitize first, then the anchors: withToc expects sanitized HTML, and sanitizing after it
      // would be trusting ids nobody checked. The stored body was sanitized on save, but the
      // allowlist may have changed since, and rows also arrive by psql and by restore.
      body = withToc(sanitizePostHtml(row.bodyHtml));
    } catch (err) {
      // One bad row must not take the whole blog down with it: skipped, and said out loud.
      log({
        at: "public",
        skipped: row.slug,
        lang: row.lang,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    const category =
      row.categorySlug === null || row.categoryNamePt === null || row.categoryNameEn === null
        ? null
        : { slug: row.categorySlug, namePt: row.categoryNamePt, nameEn: row.categoryNameEn };
    if (category) categories.set(category.slug, category);
    const hasAuthor = row.authorSlug !== null && row.authorName !== null;
    if (hasAuthor) {
      authors.set(row.authorSlug as string, {
        slug: row.authorSlug as string,
        name: row.authorName as string,
        bioPt: row.authorBioPt ?? "",
        bioEn: row.authorBioEn ?? "",
        avatarUrl: mediaOrNull(row.authorAvatarUrl),
      });
    }

    // blog_posts_published_chk guarantees the date on a published row; the fallback is for the
    // type, not for a case that exists.
    const publishedAt = row.publishedAt ?? row.updatedAt;
    served.push({
      group: row.translationGroup,
      post: {
        slug: row.slug,
        lang: row.lang,
        title: row.title,
        excerpt: row.excerpt,
        html: body.html,
        toc: body.items,
        readingMinutes: readingTimeMinutes(body.html),
        category,
        tags: row.tags,
        author: hasAuthor
          ? { slug: row.authorSlug as string, name: row.authorName as string }
          : null,
        coverUrl: mediaOrNull(row.coverUrl),
        coverAlt: row.coverAlt,
        metaTitle: row.metaTitle,
        metaDescription: row.metaDescription,
        featured: row.featured,
        publishedAt: publishedAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        translationSlug: null,
      },
    });
  }

  // Linked only among what is actually being served: a translation that is a draft, or that was
  // skipped above, would be a link to a 404 on the site.
  const byGroup = new Map<string, PublicPost[]>();
  for (const { group, post } of served) byGroup.set(group, [...(byGroup.get(group) ?? []), post]);
  for (const { group, post } of served) {
    const other = (byGroup.get(group) ?? []).find((p) => p.lang !== post.lang);
    post.translationSlug = other?.slug ?? null;
  }

  const bySlug = (a: { slug: string }, b: { slug: string }) => (a.slug < b.slug ? -1 : 1);
  return {
    posts: served.map((s) => s.post),
    categories: [...categories.values()].sort(bySlug),
    authors: [...authors.values()].sort(bySlug),
  };
}

// A cheap stand-in for "did the public payload change?": no body is read. It covers exactly what
// the payload is made of, and nothing else: the published posts (id, updated_at and xmin) and the
// categories and authors those posts point at (whole rows: they have no updated_at, and are
// small).
//
// xmin is the id of the transaction that last wrote the row, so it changes on every UPDATE.
// updated_at alone would miss two saves that land in the same instant, and a fix made in psql
// that leaves the column alone; with xmin both are seen.
//
// Nothing unpublished is in it on purpose. The ETag is derived from this and is visible to
// anyone: if saving a draft moved it, outsiders could watch the editing happen, and every
// keystroke-save would throw the memo away. An unpublish still changes it: the set shrinks.
export async function publicFingerprint(db: Db): Promise<string> {
  const rows = await db.execute<{ fingerprint: string }>(sql`
    select md5(
      coalesce((
        select string_agg(
          p.id::text || ':' || p.xmin::text || ':' || extract(epoch from p.updated_at)::text,
          ',' order by p.id)
        from blog_posts p where p.status = 'publicado'), '')
      || '|' ||
      coalesce((
        select string_agg(md5(c::text), ',' order by c.id) from blog_categories c
        where c.id in (select category_id from blog_posts where status = 'publicado')), '')
      || '|' ||
      coalesce((
        select string_agg(md5(a::text), ',' order by a.id) from blog_authors a
        where a.id in (select author_id from blog_posts where status = 'publicado')), '')
    ) as fingerprint`);
  const fingerprint = rows[0]?.fingerprint;
  if (!fingerprint) throw new Error("public fingerprint: the query returned no row");
  return fingerprint;
}

export type PublicRead = {
  fingerprint: string;
  payload: PublicPayload;
  // The payload already serialised: the route sends this string as is.
  json: string;
};

const FINGERPRINT_TTL_MS = 2_000;

// Building the payload sanitizes every published body, about half a second each at the size cap,
// and this is a public URL: without a memo, anyone could make the server do that per request.
//
// Two layers, both per process:
// - the payload (and its JSON) is kept for the current fingerprint, and rebuilt only when the
//   fingerprint changes;
// - the fingerprint itself is kept for two seconds, so a flood of requests costs one small query
//   every two seconds instead of one each. The price is that a publish takes up to two seconds
//   to show here, next to a rebuild that waits a minute.
//
// The fingerprint is read before the build, so the payload is never older than its key; when a
// write lands between the two, a later request sees a new fingerprint and builds again.
// Promises are what is stored, so requests that arrive during a query or a build share it; a
// failure is never remembered.
export function createPublicReader(
  opts: {
    build?: (db: Db) => Promise<PublicPayload>;
    fingerprint?: (db: Db) => Promise<string>;
    ttlMs?: number;
    now?: () => number;
  } = {},
) {
  const build = opts.build ?? ((db: Db) => getPublicPayload(db));
  const fingerprint = opts.fingerprint ?? publicFingerprint;
  const ttlMs = opts.ttlMs ?? FINGERPRINT_TTL_MS;
  const now = opts.now ?? Date.now;

  let key: { at: number; value: Promise<string> } | null = null;
  let memo: { key: string; read: Promise<PublicRead> } | null = null;

  return async (db: Db): Promise<PublicRead> => {
    const time = now();
    if (key === null || time - key.at >= ttlMs || time < key.at) {
      const asked = { at: time, value: fingerprint(db) };
      key = asked;
      asked.value.catch(() => {
        if (key === asked) key = null;
      });
    }
    const current = await key.value;

    if (memo?.key !== current) {
      const read = build(db).then((payload) => ({
        fingerprint: current,
        payload,
        json: JSON.stringify(payload),
      }));
      const entry = { key: current, read };
      memo = entry;
      read.catch(() => {
        if (memo === entry) memo = null;
      });
      return read;
    }
    return memo.read;
  };
}

// One memo per process: this is what the route uses.
export const readPublic = createPublicReader();
