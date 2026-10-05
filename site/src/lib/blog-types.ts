// The shape of GET <studio>/api/public/posts, copied from studio/src/blog/public.ts. The studio's
// suite (studio/tests/site-fixture-contract.test.ts) reads this file and fails when a field here
// and a field there stop matching, so keep each field on its own line.
//
// THE FIELD CONTRACT:
// - `html` (on a post) is the only field that is HTML. The studio's sanitizer already ran its
//   allowlist over it and it may be inserted as markup.
// - EVERY other string is plain text and must be escaped for the place it goes: title, excerpt,
//   tags, meta fields, cover alt, category and author names, bios, and `toc[].text` too (entities
//   are already decoded there, so a heading that talks about "<script>" arrives as those literal
//   characters).
// - A title may legitimately contain "<", "&" or "</script>". Inside a JSON-LD block that string
//   closes the element: serialise with serializeJsonLd (blog-jsonld.ts), never JSON.stringify.
// - `coverUrl` and `avatarUrl` are root-relative /media/... paths or null, never another origin.

export type BlogLang = "pt" | "en";

// `text` is plain text with entities decoded ("Tom & Jerry"), not HTML: render it escaped.
export type TocItem = {
  id: string;
  text: string;
  level: 2 | 3;
};

export type PublicCategory = {
  slug: string;
  namePt: string;
  nameEn: string;
};

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
  lang: BlogLang;
  title: string;
  excerpt: string | null;
  // The only HTML field. Sanitized, with ids on h2/h3. Shortcodes are still {{name}} markers at
  // block level: blog-body.ts cuts the body at them.
  html: string;
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
  // The first publication, not the last edit.
  publishedAt: string;
  updatedAt: string;
  // The slug of the same post in the other language, only when that one is published too.
  translationSlug: string | null;
};

// Categories and authors are only the ones a served post refers to.
export type PublicPayload = {
  posts: PublicPost[];
  categories: PublicCategory[];
  authors: PublicAuthor[];
};
