import { defineConfig } from "tsdown";

export default defineConfig({
  // `bootstrap` is the second operator surface's way in (ADR-021): the dashboard's server
  // routes build the same stages `init` sends, so the two cannot drift. It needs
  // declarations because the dashboard typechecks against it; the bin does not.
  entry: ["src/cli.ts", "src/bootstrap.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  platform: "node",
});
