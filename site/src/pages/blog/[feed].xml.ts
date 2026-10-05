// /blog/rss.xml. The name is a parameter with a single value ("rss") so that, with the blog off,
// getStaticPaths can answer "no such route"; a file called rss.xml.ts would always be written.
import type { APIRoute } from "astro";
import { getCopy } from "../../content/copy";
import { feedPaths, feedResponse } from "../../lib/blog-pages";

const lang = "en" as const;

export const getStaticPaths = () => feedPaths(lang);

export const GET: APIRoute = () => {
  const c = getCopy(lang).blog;
  return feedResponse(lang, { title: `Ash — ${c.title}`, description: c.intro });
};
