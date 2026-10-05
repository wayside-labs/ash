import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// .env.test holds TEST_DATABASE_URL (deploy/testdb.sh). Missing is fine: tests/helpers/db.ts
// then says loudly that the database suites were skipped.
try {
  loadEnvFile(".env.test");
} catch {}

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    globals: true,
    // freshDb drops and re-migrates over an SSH tunnel: ~5 s per test, well over the 5 s default.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // Component tests are .tsx and opt into jsdom per file (`// @vitest-environment jsdom`); the
    // default stays node, which is what the database and bundle suites need.
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    // The integration suites share one database; running files in parallel would race on it.
    fileParallelism: false,
  },
});
