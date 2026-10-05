import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

// scripts/check-deploy.mjs is the first step of `pnpm run deploy`.
function run(source: string | undefined) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== "BLOG_SOURCE") env[key] = value;
  if (source !== undefined) env.BLOG_SOURCE = source;
  return spawnSync(process.execPath, ["scripts/check-deploy.mjs"], { env, encoding: "utf8" });
}

describe("the deploy guard", () => {
  it("refuses to deploy the sample posts, and says what to do instead", () => {
    for (const source of ["fixture", " fixture "]) {
      const out = run(source);
      expect(out.status).toBe(1);
      expect(out.stderr).toContain("deploy refused: BLOG_SOURCE=fixture");
      expect(out.stderr).toContain("BLOG_SOURCE=api");
    }
  });
  it.each([undefined, "", "off", "api"])("lets BLOG_SOURCE=%j through", (source) => {
    const out = run(source);
    expect(out.status).toBe(0);
    expect(out.stderr).toBe("");
  });
  it("is the first thing the deploy script runs", () => {
    const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<string, string>;
    expect(scripts.deploy?.startsWith("node scripts/check-deploy.mjs && ")).toBe(true);
    expect(scripts.deploy).toContain("wrangler pages deploy");
  });
});
