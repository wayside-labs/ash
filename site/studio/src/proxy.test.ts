import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { __resetEnvCacheForTests as resetEnvCache } from "@/lib/env";
import { config, proxy } from "./proxy";

const call = (
  host: string,
  path: string,
  headers: Record<string, string> = {},
  method = "GET",
) => proxy(new NextRequest(`http://${host}${path}`, { method, headers: { host, ...headers } }));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("DATABASE_URL", "postgres://u:p@db:5432/studio");
  vi.stubEnv("STUDIO_HOST", "studio.ash.app.br");
  vi.stubEnv("PUBLIC_HOST", "pub.ash.app.br");
  vi.stubEnv("ACCESS_TEAM_DOMAIN", "team.cloudflareaccess.com");
  vi.stubEnv("ACCESS_AUD", "aud-1");
  vi.stubEnv("STUDIO_ADMINS", "lucas@example.com");
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("proxy", () => {
  it("pub na raiz é 404", async () => {
    expect((await call("pub.ash.app.br", "/")).status).toBe(404);
  });
  it("pub em _next/image é 404 (o otimizador não pode contornar o proxy)", async () => {
    expect((await call("pub.ash.app.br", "/_next/image?url=/x&w=64&q=75")).status).toBe(404);
  });
  it("pub em rota pública passa", async () => {
    const res = await call("pub.ash.app.br", "/media/x.webp");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });
  it("pub recusa server action", async () => {
    expect((await call("pub.ash.app.br", "/media/x.webp", { "next-action": "abc" })).status).toBe(
      404,
    );
  });
  it("studio sem token é 403", async () => {
    expect((await call("studio.ash.app.br", "/")).status).toBe(403);
  });
  it("host desconhecido é 404", async () => {
    expect((await call("evil.example", "/")).status).toBe(404);
  });
  it("pub recusa POST multipart (server action em form HTML)", async () => {
    const h = { "content-type": "multipart/form-data; boundary=x" };
    expect((await call("pub.ash.app.br", "/media/x.webp", h, "POST")).status).toBe(404);
  });
  it("pub aceita POST urlencoded (descadastro de um clique, RFC 8058)", async () => {
    const h = { "content-type": "application/x-www-form-urlencoded" };
    expect((await call("pub.ash.app.br", "/media/x.webp", h, "POST")).status).toBe(200);
  });
});

describe("matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });
  it.each(["/_next/image?url=/x&w=64&q=75", "/_next/staticX", "/faviconXico", "/"])(
    "cobre %s",
    (url) => expect(matches(url)).toBe(true),
  );
  it.each(["/_next/static/chunks/a.js", "/favicon.ico"])("não cobre %s", (url) =>
    expect(matches(url)).toBe(false),
  );
});
