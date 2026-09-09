import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/constants.ts",
    "src/reason-codes.ts",
    "src/events.ts",
    "src/payment-build.ts",
    "src/mcp-tools.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
});
