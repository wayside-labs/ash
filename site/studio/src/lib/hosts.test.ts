import { surfaceFor } from "./hosts";

const hosts = { studio: "studio.ash.app.br", pub: "pub.ash.app.br" };

describe("surfaceFor", () => {
  it("studio é admin em qualquer rota", () => {
    expect(surfaceFor("studio.ash.app.br", "/", hosts)).toBe("admin");
    expect(surfaceFor("STUDIO.ash.app.br:443", "/x", hosts)).toBe("admin");
  });
  it("pub só abre as rotas públicas", () => {
    expect(surfaceFor("pub.ash.app.br", "/api/public/posts", hosts)).toBe("public");
    expect(surfaceFor("pub.ash.app.br", "/newsletter/confirmar", hosts)).toBe("public");
    expect(surfaceFor("pub.ash.app.br", "/descadastro", hosts)).toBe("public");
    expect(surfaceFor("pub.ash.app.br", "/media/a.webp", hosts)).toBe("public");
    expect(surfaceFor("pub.ash.app.br", "/", hosts)).toBe("deny");
    expect(surfaceFor("pub.ash.app.br", "/api/health", hosts)).toBe("deny");
    expect(surfaceFor("pub.ash.app.br", "/descadastro-falso", hosts)).toBe("deny");
  });
  it("loopback só vê o health (healthcheck do Docker)", () => {
    expect(surfaceFor("127.0.0.1:3000", "/api/health", hosts)).toBe("internal");
    expect(surfaceFor("localhost:3000", "/", hosts)).toBe("deny");
  });
  it("casos de borda", () => {
    expect(surfaceFor("pub.ash.app.br.", "/media/x", hosts)).toBe("deny");
    expect(surfaceFor("pub.ash.app.br", "/media", hosts)).toBe("deny");
    expect(surfaceFor("pub.ash.app.br", "/newsletter", hosts)).toBe("deny");
    expect(surfaceFor("127.0.0.1", "/", hosts)).toBe("deny");
    expect(surfaceFor("pub.ash.app.br", "/MEDIA/x", hosts)).toBe("deny");
  });
  it("host desconhecido ou ausente é negado", () => {
    expect(surfaceFor("evil.example", "/", hosts)).toBe("deny");
    expect(surfaceFor(null, "/", hosts)).toBe("deny");
  });
});
