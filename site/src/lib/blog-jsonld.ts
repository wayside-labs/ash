import { absoluteUrl } from "./blog-paths";

// Structured data for a post. Pure objects; the page serialises them with serializeJsonLd and
// nothing else. Brand, language and domain all arrive as parameters.

export interface BlogPostingInput {
  siteUrl: string;
  // A BCP 47 tag, e.g. "en" or "pt-BR".
  inLanguage: string;
  publisherName: string;
  headline: string;
  path: string;
  datePublished: string;
  dateModified?: string | null;
  description?: string | null;
  authorName?: string | null;
  authorPath?: string | null;
  // A path on this site (/blog-media/...), never the studio's address.
  imagePath?: string | null;
  articleSection?: string | null;
  keywords?: readonly string[];
}

// No publisher.logo: Google only accepts a real raster logo there, and a made-up URL would be a
// 404, which is worse than leaving the field out.
export function blogPostingLd(input: BlogPostingInput): Record<string, unknown> {
  const url = absoluteUrl(input.siteUrl, input.path);
  const publisher = { "@type": "Organization", name: input.publisherName, url: absoluteUrl(input.siteUrl, "/") };
  return {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: input.headline,
    ...(input.description ? { description: input.description } : {}),
    url,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    datePublished: input.datePublished,
    ...(input.dateModified ? { dateModified: input.dateModified } : {}),
    ...(input.imagePath ? { image: [absoluteUrl(input.siteUrl, input.imagePath)] } : {}),
    ...(input.articleSection ? { articleSection: input.articleSection } : {}),
    ...(input.keywords && input.keywords.length > 0 ? { keywords: input.keywords.join(", ") } : {}),
    inLanguage: input.inLanguage,
    // A post with no author is signed by the house.
    author: input.authorName
      ? { "@type": "Person", name: input.authorName, ...(input.authorPath ? { url: absoluteUrl(input.siteUrl, input.authorPath) } : {}) }
      : publisher,
    publisher,
  };
}

export function breadcrumbLd(items: ReadonlyArray<{ name: string; path: string }>, siteUrl: string): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: absoluteUrl(siteUrl, item.path),
    })),
  };
}

// The characters that end or confuse a <script> element, and the two line separators that are
// legal in JSON and were not in JavaScript. The list and the escape are built from char codes:
// no escape sequence is written in this file, so no tool can decode one on the way to disk.
const DANGEROUS = new RegExp(`[<>&${String.fromCharCode(0x2028, 0x2029)}]`, "g");
const BACKSLASH = String.fromCharCode(92);
const escapeChar = (ch: string): string => `${BACKSLASH}u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;

// The only way a JSON-LD object reaches a page. A title may contain "</script>": a bare
// JSON.stringify would let it close the element and run what follows. Each dangerous character
// becomes its six-character JSON escape, which a JSON parser reads back as the same character.
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(DANGEROUS, escapeChar);
}
