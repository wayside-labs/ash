import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  retries: 0,
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:4321", trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node scripts/serve-dist.mjs 4321",
    url: "http://127.0.0.1:4321/",
    reuseExistingServer: false,
    timeout: 20_000,
  },
});
