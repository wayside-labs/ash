import { adminFromToken } from "./admin-token";
import type { Env } from "./env";

// Built by hand on purpose: the zod refine would refuse this combination, and the point is that
// adminFromToken must not trust the schema alone.
const base: Env = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@db:5432/studio",
  STUDIO_HOST: "studio.ash.app.br",
  PUBLIC_HOST: "pub.ash.app.br",
  ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
  ACCESS_AUD: "aud-1",
  STUDIO_ADMINS: ["lucas@example.com"],
  EMAIL_DRIVER: "none",
  APP_VERSION: "dev",
  STUDIO_DEV_ADMIN: "dev@example.com",
  UPLOADS_DIR: "uploads",
  PUBLISH_TZ: "America/Sao_Paulo",
  GITHUB_DISPATCH_TOKEN: undefined,
  GITHUB_DISPATCH_REPO: "lglucas/ash-web",
  SITE_REBUILD: undefined,
};

describe("adminFromToken", () => {
  it("ignora o atalho de admin fora de development", async () => {
    expect(await adminFromToken(null, base)).toBeNull();
  });
  it("usa o atalho de admin em development", async () => {
    expect(await adminFromToken(null, { ...base, NODE_ENV: "development" })).toEqual({
      email: "dev@example.com",
    });
  });
});
