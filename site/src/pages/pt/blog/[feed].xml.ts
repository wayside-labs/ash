// /pt/blog/rss.xml. Same file as src/pages/blog/[feed].xml.ts but the language.
import type { APIRoute } from "astro";
import { getCopy } from "../../../content/copy";
import { feedPaths, feedResponse } from "../../../lib/blog-pages";

const lang = "pt" as const;

export const getStaticPaths = () => feedPaths(lang);

export const GET: APIRoute = () => {
  const c = getCopy(lang).blog;
  return feedResponse(lang, { title: `Ash — ${c.title}`, description: c.intro });
};
