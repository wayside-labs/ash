import { test } from "@playwright/test";

// The blog specs need a dist/ built with BLOG_SOURCE=fixture. A plain `pnpm build` leaves the
// blog off, and thirty tests failing on a missing page say nothing about why: this fails each
// blog spec once, with the command to run. Not a spec itself (Playwright collects *.spec.ts).
export function requireFixtureBuild(): void {
  test.beforeAll(async ({ playwright }, info) => {
    const api = await playwright.request.newContext({ baseURL: info.project.use.baseURL as string });
    const status = (await api.get("/blog/")).status();
    await api.dispose();
    if (status !== 200) {
      throw new Error("dist/ has no blog: build with BLOG_SOURCE=fixture (BLOG_SOURCE=fixture pnpm build) before pnpm test:e2e.");
    }
  });
}
