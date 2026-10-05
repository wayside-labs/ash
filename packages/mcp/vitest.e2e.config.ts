import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, "../..");

/**
 * Layer 5 of the test pyramid (ADR-008): a real validator, run on demand.
 *
 * Separate from the default config because these need `surfpool`, the Solana CLI, and a
 * built `target/deploy/ash.so` — none of which a contributor should need to run
 * layers 1 to 4 in seconds.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@ash/e2e/harness/blinding-proxy": resolve(
        repoRoot,
        "packages/e2e/src/harness/blinding-proxy.ts",
      ),
      "@ash/e2e/harness/surfnet": resolve(repoRoot, "packages/e2e/src/harness/surfnet.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["e2e/**/*.e2e.test.ts"],
    // One surfnet, one fixture, one ordered narrative: the suite counts payments against a
    // single vault balance, so the files must not race each other.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 120_000,
    hookTimeout: 300_000,
  },
});
