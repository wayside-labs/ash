import { test, expect, type Page } from "@playwright/test";
import { requireFixtureBuild } from "./blog-build";

// The two languages of the blog and its lists by category, tag and author, against the fixture
// build.

requireFixtureBuild();

const cards = (page: Page) => page.locator("main article[data-post]");

test.describe("languages", () => {
  test("the Portuguese index is in Portuguese, with its own posts and no second page", async ({ page }) => {
    await page.goto("/pt/blog/");
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(cards(page)).toHaveCount(3);
    await expect(page.getByRole("navigation", { name: "Paginação" })).toHaveCount(0);
    await expect(page.locator('link[hreflang="en"]')).toHaveAttribute("href", "https://ash.app.br/blog/");
    await expect(page.getByRole("link", { name: "Todos os posts" })).toHaveAttribute("aria-current", "page");
  });

  test("a translated pair points at each other and the language switch lands on the translation", async ({ page }) => {
    await page.goto("/blog/how-this-blog-is-built/");
    await expect(page.locator('link[hreflang="pt-BR"]')).toHaveAttribute("href", "https://ash.app.br/pt/blog/como-este-blog-e-feito/");
    await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute("href", "https://ash.app.br/blog/how-this-blog-is-built/");
    await expect(page.locator("article > header")).toContainText("Updated September 29, 2026");
    await page.getByRole("link", { name: "PT", exact: true }).click();
    await expect(page).toHaveURL(/\/pt\/blog\/como-este-blog-e-feito\/$/);
    await expect(page.locator("html")).toHaveAttribute("lang", "pt-BR");
    await expect(page.locator("h1")).toHaveText("Exemplo: como este blog é feito");
    await expect(page.locator("article > header time").first()).toHaveText("28 de setembro de 2026");
    await expect(page.locator('link[hreflang="en"]')).toHaveAttribute("href", "https://ash.app.br/blog/how-this-blog-is-built/");
    await expect(page.locator('link[hreflang="x-default"]')).toHaveAttribute("href", "https://ash.app.br/blog/how-this-blog-is-built/");
    await page.getByRole("link", { name: "Read in English" }).click();
    await expect(page).toHaveURL(/\/blog\/how-this-blog-is-built\/$/);
  });

  test("an untranslated post advertises no alternate and the switch goes to the other blog", async ({ page }) => {
    await page.goto("/blog/a-short-post/");
    await expect(page.locator("link[hreflang]")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Leia em português" })).toHaveCount(0);
    await page.getByRole("link", { name: "PT", exact: true }).click();
    await expect(page).toHaveURL(/\/pt\/blog\/$/);
    await page.goto("/pt/blog/um-post-curto/");
    await expect(page.locator("link[hreflang]")).toHaveCount(0);
    await page.getByRole("link", { name: "EN", exact: true }).click();
    await expect(page).toHaveURL(/\/blog\/$/);
  });
});

test.describe("category, tag and author", () => {
  test("a category lists its posts and alternates only where the other language has it", async ({ page }) => {
    await page.goto("/blog/category/engineering/");
    await expect(page.locator("h1")).toHaveText("Engineering");
    await expect(cards(page)).toHaveCount(3);
    await expect(page.locator("link[hreflang]")).toHaveCount(0);
    await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
    await page.goto("/blog/category/product/");
    await expect(page.locator('link[hreflang="pt-BR"]')).toHaveAttribute("href", "https://ash.app.br/pt/blog/categoria/product/");
    await page.goto("/pt/blog/categoria/product/");
    await expect(page.locator("h1")).toHaveText("Produto");
    await expect(cards(page)).toHaveCount(2);
  });

  test("a tag page is noindex, has no alternate and lists the posts with the tag", async ({ page }) => {
    await page.goto("/blog/tag/writing/");
    await expect(page.locator("h1")).toHaveText("writing");
    await expect(cards(page)).toHaveCount(5);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, follow");
    await expect(page.locator("link[hreflang]")).toHaveCount(0);
    // A tag with accents and spaces has an ASCII address and its own spelling on the page.
    await page.goto("/pt/blog/tag/guia-de-redacao/");
    await expect(page.locator("h1")).toHaveText("guia de redação");
    await expect(cards(page)).toHaveCount(2);
  });

  test("an author page shows the bio, the picture from this site and the posts", async ({ page }) => {
    await page.goto("/blog/author/ash-team/");
    await expect(page.locator("h1")).toHaveText("Ash team");
    await expect(page.locator("main > header")).toContainText("Sample author, used to test the blog.");
    const avatar = page.locator("main > header img");
    await expect(avatar).toHaveAttribute("src", /^\/blog-media\/autores\//);
    await expect.poll(() => avatar.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expect(cards(page)).toHaveCount(13);
    await expect(page.locator('link[hreflang="pt-BR"]')).toHaveAttribute("href", "https://ash.app.br/pt/blog/autor/ash-team/");
  });
});
