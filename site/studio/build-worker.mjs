// Bundles the worker and the migrator: Next's standalone output only traces the web server.
import { build } from "esbuild";

await build({
  entryPoints: { worker: "src/worker/main.ts", migrate: "src/db/migrate.ts" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  tsconfig: "tsconfig.json",
  // Some deps still call require(); ESM bundles need it provided.
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
});
