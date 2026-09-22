import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    coverage: {
      provider: "v8",
      // Source only, and `include` is load-bearing: without it v8 reports only the files a
      // test happened to import, which silently drops untested modules from the denominator.
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/cli.ts", "src/fixtures.ts"],
      reporter: ["text", "lcov"],
    },
  },
});
