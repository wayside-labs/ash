import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/constants.ts", "src/reason-codes.ts", "src/events.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
});
