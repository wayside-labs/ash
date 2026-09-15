import { defineConfig } from "vitest/config";

/**
 * Layer 5 of the test pyramid (ADR-008): a real validator, run on demand.
 *
 * Separate from the default config because these need `surfpool`, the Solana CLI, and a
 * built `target/deploy/agent_rails.so` — none of which a contributor should need to run
 * layers 1 to 4 in seconds.
 */
export default defineConfig({
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
