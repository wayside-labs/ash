import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // E2E needs a validator and lives behind `pnpm test:e2e` (vitest.e2e.config.ts).
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
