import { defineConfig } from "vitest/config";

// Only the unit suite; tests/e2e is Playwright and must not be collected here.
export default defineConfig({
  test: { include: ["tests/unit/**/*.test.ts"] },
});
