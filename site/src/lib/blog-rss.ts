import { absoluteUrl, blogIndexPath, postPath, rssPath } from "./blog-paths";
import type { BlogLang, PublicPost } from "./blog-types";

// The feed of one language, as a string. Titles and excerpts are plain text and go in escaped;
// the post body never goes in.

const XML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" };

// Escapes the five characters and drops what XML 1.0 cannot carry at all (control characters,
// lone surrogates, U+FFFE/FFFF): one of those in a title would make every reader reject the feed.
function xmlText(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) as number;
    const legal = code === 0x9 || code === 0xa || code === 0xd || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || code >= 0x10000;
    if (legal) out += XML_ESCAPES[ch] ?? ch;
  }
  return out;
}

const LANGUAGE: Record<BlogLang, string> = { en: "en", pt: "pt-BR" };
// RFC 822 with a four-digit year, as RSS 2.0 asks: "Mon, 28 Sep 2026 13:00:00 GMT".
const rfc822 = (iso: string): string => new Date(iso).toUTCString();

export interface RssInput {
  lang: BlogLang;
  // Newest first; posts of the other language are ignored.
  posts: readonly PublicPost[];
  siteUrl: string;
  title: string;
  description: string;
  limit?: number;
}

export function rssXml(input: RssInput): string {
  const { lang, siteUrl } = input;
  const posts = input.posts.filter((p) => p.lang === lang).slice(0, input.limit ?? 20);
  const newest = posts.reduce((max, p) => Math.max(max, Date.parse(p.updatedAt), Date.parse(p.publishedAt)), 0);

  const items = posts.map((post) => {
    const url = xmlText(absoluteUrl(siteUrl, postPath(lang, post.slug)));
    return [
      "<item>",
      `<title>${xmlText(post.title)}</title>`,
      `<link>${url}</link>`,
      `<guid isPermaLink="true">${url}</guid>`,
      `<pubDate>${rfc822(post.publishedAt)}</pubDate>`,
      ...(post.excerpt ? [`<description>${xmlText(post.excerpt)}</description>`] : []),
      "</item>",
    ].join("");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">',
    "<channel>",
    `<title>${xmlText(input.title)}</title>`,
    `<link>${xmlText(absoluteUrl(siteUrl, blogIndexPath(lang)))}</link>`,
    `<description>${xmlText(input.description)}</description>`,
    `<language>${LANGUAGE[lang]}</language>`,
    ...(posts.length > 0 ? [`<lastBuildDate>${rfc822(new Date(newest).toISOString())}</lastBuildDate>`] : []),
    `<atom:link href="${xmlText(absoluteUrl(siteUrl, rssPath(lang)))}" rel="self" type="application/rss+xml" />`,
    ...items,
    "</channel>",
    "</rss>",
    "",
  ].join("\n");
}
