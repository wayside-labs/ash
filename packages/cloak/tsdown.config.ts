import { defineConfig } from "tsdown";

// `index` and `adapter` are imported by the dashboard's browser bundle; `node` and `smoke` are not.
// The SDK stays an external dynamic import so it loads only when a run starts.
export default defineConfig({
  entry: [
    "src/index.ts",
    "src/adapter.ts",
    "src/node.ts",
    "src/testing.ts",
    "src/smoke.ts",
    "src/verify-hash.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
});
