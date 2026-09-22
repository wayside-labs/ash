import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Route handlers are imported by the enumeration test, and `@/…` is what
    // they use for every internal import.
    alias: { "@": new URL("./src/", import.meta.url).pathname },
  },
});
