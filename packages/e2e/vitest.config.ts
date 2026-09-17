import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.e2e.test.ts"],
    // One surfnet, one program deployment, one treasury per run. Parallel files would
    // race for the RPC port and for the same PDAs.
    fileParallelism: false,
    // A surfnet boot plus a 700 KB program deploy is the slow part, and the blinding test
    // deliberately waits out a confirmation timeout. Unit-test defaults abort mid-deploy.
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
