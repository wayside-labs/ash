import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import { blog, isUnlistedBlogPath } from "./src/integrations/blog.ts";

// The pitch, the investor funnel and the pitch-deck frames are links we send, not pages to be found. In the blog, tag
// pages and /page/2 onwards are noindex (thin lists of what the index and the posts already
// say), so they stay out of the sitemap too; so does the index of a language with no post yet
// (isUnlistedBlogPath, which the blog integration fills from the payload).
const UNLISTED = [
  /^\/(pt\/)?(pitch|investor|investidor)\/?$/,
  /^\/pitch-deck\//,
  /^\/(pt\/)?blog\/tag\/[^/]+\/?$/,
  /^\/(pt\/)?blog\/(page|pagina)\/\d+\/?$/,
];
const listed = (page) => {
  const { pathname } = new URL(page);
  return !UNLISTED.some((pattern) => pattern.test(pathname)) && !isUnlistedBlogPath(pathname);
};

export default defineConfig({
  site: "https://ash.app.br",
  output: "static",
  trailingSlash: "ignore",
  i18n: {
    defaultLocale: "en",
    locales: ["en", "pt"],
    routing: { prefixDefaultLocale: false },
  },
  integrations: [sitemap({ filter: listed }), blog()],
  build: { inlineStylesheets: "auto" },
});
