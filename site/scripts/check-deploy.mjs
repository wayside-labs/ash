// First step of `pnpm run deploy`. The fixture is the blog of sample posts the tests use
// (including the ones that test escaping): a deploy by hand with BLOG_SOURCE=fixture left in the
// shell would publish them on ash.app.br. Refusing here costs nothing; taking them down after a
// crawler has seen them does.
const source = (process.env.BLOG_SOURCE ?? "").trim();

if (source === "fixture") {
  console.error(
    [
      "deploy refused: BLOG_SOURCE=fixture would publish the sample posts.",
      "Unset BLOG_SOURCE to deploy the site without the blog, or use",
      "BLOG_SOURCE=api with BLOG_API_URL to deploy what the studio has published.",
    ].join("\n"),
  );
  process.exit(1);
}
