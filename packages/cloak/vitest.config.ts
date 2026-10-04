import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // The first call into the real SDK initialises Poseidon (WASM) and imports ~500 kB of code;
    // under turbo, with every package testing at once, that outlasts vitest's default 5 s.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
