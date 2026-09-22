import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/constants.ts",
    "src/defi-intents.ts",
    "src/outcome.ts",
    "src/units.ts",
    "src/intent-id.ts",
    "src/security.ts",
    "src/reason-codes.ts",
    "src/events.ts",
    "src/payment-build.ts",
    "src/mcp-tools.ts",
  ],
  format: ["esm"],
  dts: true,
  clean: true,
});
