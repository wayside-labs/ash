import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // The Playwright suite lives in e2e/ and is run by `playwright test`. Vitest
    // would collect those files and fail on the first `test()` call, since
    // @playwright/test refuses to run outside its own runner.
    exclude: ["node_modules/**", "e2e/**", ".playwright/**"],
    // Route handlers are imported by the enumeration test, and `@/…` is what
    // they use for every internal import.
    alias: { "@": new URL("./src/", import.meta.url).pathname },
  },
});
