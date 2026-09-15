import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.ts", "src/server.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  platform: "node",
});
