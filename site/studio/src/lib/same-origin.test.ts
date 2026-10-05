import { refuseCrossSite } from "./same-origin";

const prod = { STUDIO_HOST: "studio.ash.app.br", NODE_ENV: "production" as const };
const dev = { STUDIO_HOST: "localhost", NODE_ENV: "development" as const };

const post = (headers: Record<string, string>) =>
  new Request("https://studio.ash.app.br/api/admin/upload", { method: "POST", headers });

describe("refuseCrossSite", () => {
  it("aceita o que um navegador manda de dentro do painel", () => {
    for (const headers of [
      { origin: "https://studio.ash.app.br", "sec-fetch-site": "same-origin" },
      // An older browser: Origin without the fetch metadata.
      { origin: "https://studio.ash.app.br" },
      // Fetch metadata without Origin.
      { "sec-fetch-site": "same-origin" },
      { origin: "https://STUDIO.ash.app.br", "sec-fetch-site": "same-origin" },
    ]) {
      expect(refuseCrossSite(post(headers), prod), JSON.stringify(headers)).toBeNull();
    }
  });

  it("recusa com 403 quando não vem nenhum dos dois cabeçalhos", async () => {
    const res = refuseCrossSite(post({}), prod);
    expect(res?.status).toBe(403);
    expect(res?.headers.get("cache-control")).toBe("no-store");
    expect(res?.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res?.json()).toEqual({ ok: false, error: expect.any(String) });
  });

  it("recusa Sec-Fetch-Site que não é same-origin, mesmo com Origin certo", () => {
    for (const site of ["cross-site", "same-site", "none", "", "SAME-ORIGIN ", "same-origin, cross-site"]) {
      const headers = { origin: "https://studio.ash.app.br", "sec-fetch-site": site };
      expect(refuseCrossSite(post(headers), prod)?.status, site).toBe(403);
    }
  });

  it("recusa Origin que não é o do painel, mesmo com Sec-Fetch-Site same-origin", () => {
    for (const origin of [
      "https://evil.example",
      "https://pub.ash.app.br",
      "https://studio.ash.app.br.evil.example",
      "https://evilstudio.ash.app.br",
      "http://studio.ash.app.br",
      "https://studio.ash.app.br:8443",
      "https://studio.ash.app.br@evil.example",
      "null",
      "",
      "studio.ash.app.br",
      "https://studio.ash.app.br/path",
    ]) {
      const headers = { origin, "sec-fetch-site": "same-origin" };
      expect(refuseCrossSite(post(headers), prod)?.status, origin).toBe(403);
    }
  });

  it("em desenvolvimento aceita http e a porta do dev server, mas só no host do painel", () => {
    expect(
      refuseCrossSite(post({ origin: "http://localhost:3100", "sec-fetch-site": "same-origin" }), dev),
    ).toBeNull();
    expect(refuseCrossSite(post({ origin: "http://evil.localhost:3100" }), dev)?.status).toBe(403);
    // And never outside development.
    expect(
      refuseCrossSite(post({ origin: "http://studio.ash.app.br:3100" }), prod)?.status,
    ).toBe(403);
  });
});
