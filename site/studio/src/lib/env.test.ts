import { readFileSync } from "node:fs";
import { EnvSchema, parseEnv, siteRebuild } from "./env";

const base = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://u:p@db:5432/studio",
  STUDIO_HOST: "studio.ash.app.br",
  PUBLIC_HOST: "pub.ash.app.br",
  ACCESS_TEAM_DOMAIN: "ashhuman.cloudflareaccess.com",
  ACCESS_AUD: "aud-tag",
  STUDIO_ADMINS: " Lucas@Example.com , outra@example.com ",
};

describe("parseEnv", () => {
  it("normaliza a lista de admins", () => {
    expect(parseEnv(base).STUDIO_ADMINS).toEqual(["lucas@example.com", "outra@example.com"]);
  });
  it("e-mail ainda não ligado é 'none' por padrão", () => {
    expect(parseEnv(base).EMAIL_DRIVER).toBe("none");
  });
  it("recusa lista de admins vazia", () => {
    expect(() => parseEnv({ ...base, STUDIO_ADMINS: " , " })).toThrow();
  });
  it("NODE_ENV ausente vale production", () => {
    const { NODE_ENV: _omit, ...rest } = base;
    expect(parseEnv(rest).NODE_ENV).toBe("production");
  });
  it("recusa host com esquema, porta ou barra", () => {
    for (const bad of ["https://pub.ash.app.br", "pub.ash.app.br:443", "pub.ash.app.br/x"]) {
      expect(() => parseEnv({ ...base, PUBLIC_HOST: bad })).toThrow();
    }
    expect(() => parseEnv({ ...base, ACCESS_TEAM_DOMAIN: "https://x.cloudflareaccess.com" })).toThrow();
  });
  it("recusa host com ponto final ou sem ponto", () => {
    expect(() => parseEnv({ ...base, STUDIO_HOST: "studio.ash.app.br." })).toThrow();
    expect(() => parseEnv({ ...base, STUDIO_HOST: "studio" })).toThrow();
  });
  it("aceita localhost (só esse nome sem ponto) para o dev local", () => {
    const dev = { ...base, NODE_ENV: "development" };
    expect(parseEnv({ ...dev, STUDIO_HOST: "localhost" }).STUDIO_HOST).toBe("localhost");
    expect(() => parseEnv({ ...base, STUDIO_HOST: "intranet" })).toThrow();
  });
  it("localhost fora de development é recusado", () => {
    expect(() => parseEnv({ ...base, STUDIO_HOST: "localhost" })).toThrow(/development/);
    expect(() => parseEnv({ ...base, PUBLIC_HOST: "localhost" })).toThrow(/development/);
  });
  it("normaliza host para minúsculas", () => {
    expect(parseEnv({ ...base, STUDIO_HOST: "Studio.Ash.App.BR" }).STUDIO_HOST).toBe("studio.ash.app.br");
  });
  it("recusa STUDIO_HOST igual a PUBLIC_HOST", () => {
    expect(() => parseEnv({ ...base, PUBLIC_HOST: "studio.ash.app.br" })).toThrow();
  });
  it("recusa o atalho de admin fora de development", () => {
    expect(() => parseEnv({ ...base, STUDIO_DEV_ADMIN: "a@b.co" })).toThrow(/development/);
  });
  it("aceita o atalho de admin em development", () => {
    const e = parseEnv({ ...base, NODE_ENV: "development", STUDIO_DEV_ADMIN: "a@b.co" });
    expect(e.STUDIO_DEV_ADMIN).toBe("a@b.co");
  });

  it("blog: padrões de uploads, fuso e repositório; token ausente", () => {
    expect(parseEnv(base)).toMatchObject({
      UPLOADS_DIR: "uploads",
      PUBLISH_TZ: "America/Sao_Paulo",
      GITHUB_DISPATCH_REPO: "lglucas/ash-web",
    });
    expect(parseEnv(base).GITHUB_DISPATCH_TOKEN).toBeUndefined();
  });
  it("blog: aceita os valores dados", () => {
    const e = parseEnv({
      ...base,
      UPLOADS_DIR: "/data/uploads",
      PUBLISH_TZ: "Europe/Lisbon",
      GITHUB_DISPATCH_TOKEN: "ghx-not-a-real-token",
      GITHUB_DISPATCH_REPO: "someone/some.repo-1",
    });
    expect(e).toMatchObject({
      UPLOADS_DIR: "/data/uploads",
      PUBLISH_TZ: "Europe/Lisbon",
      GITHUB_DISPATCH_TOKEN: "ghx-not-a-real-token",
      GITHUB_DISPATCH_REPO: "someone/some.repo-1",
    });
  });
  it("blog: fuso que não existe é recusado", () => {
    for (const bad of ["Mars/Olympus", "BRT-3 hours", ""]) {
      expect(() => parseEnv({ ...base, PUBLISH_TZ: bad }), bad).toThrow();
    }
  });
  it("blog: token vazio no .env vale como ausente (rebuild desligado)", () => {
    expect(parseEnv({ ...base, GITHUB_DISPATCH_TOKEN: "" }).GITHUB_DISPATCH_TOKEN).toBeUndefined();
    expect(parseEnv({ ...base, GITHUB_DISPATCH_TOKEN: "  " }).GITHUB_DISPATCH_TOKEN).toBeUndefined();
  });
  it("blog: repositório precisa ser dono/nome", () => {
    for (const bad of [
      "ash-web",
      "https://github.com/lglucas/ash-web",
      "a/b/c",
      "a/../b",
      "owner/.",
      "owner/..",
      "owner/...",
    ]) {
      expect(() => parseEnv({ ...base, GITHUB_DISPATCH_REPO: bad }), bad).toThrow();
    }
    expect(parseEnv({ ...base, GITHUB_DISPATCH_REPO: "owner/.github" }).GITHUB_DISPATCH_REPO).toBe(
      "owner/.github",
    );
  });
  it("blog: rebuild ligado com o token, ou com a bandeira que o compose passa ao app", () => {
    expect(siteRebuild(parseEnv(base))).toBe("off");
    expect(siteRebuild(parseEnv({ ...base, GITHUB_DISPATCH_TOKEN: "ghx-x" }))).toBe("on");
    expect(siteRebuild(parseEnv({ ...base, GITHUB_DISPATCH_TOKEN: "", SITE_REBUILD: "on" }))).toBe(
      "on",
    );
    // What compose gives the app when the token is not set: both empty.
    expect(siteRebuild(parseEnv({ ...base, GITHUB_DISPATCH_TOKEN: "", SITE_REBUILD: "" }))).toBe(
      "off",
    );
    expect(siteRebuild(parseEnv({ ...base, SITE_REBUILD: "talvez" }))).toBe("off");
  });
  it("blog: o erro de validação não repete o token", () => {
    const secret = "ghx-secret-value-that-must-not-leak";
    try {
      parseEnv({ ...base, GITHUB_DISPATCH_TOKEN: secret, GITHUB_DISPATCH_REPO: "invalido" });
      throw new Error("did not throw");
    } catch (err) {
      expect(String(err)).not.toContain(secret);
      expect(JSON.stringify(err)).not.toContain(secret);
    }
  });
});

describe(".env.example", () => {
  const text = readFileSync(".env.example", "utf8");
  const assigned = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if (match) assigned.set(match[1] as string, match[2] as string);
  }

  it("tem toda variável que o env.ts lê, e nenhuma que ele não lê", () => {
    expect([...assigned.keys()].sort()).toEqual(Object.keys(EnvSchema.shape).sort());
  });

  it("os valores de exemplo formam um ambiente de desenvolvimento válido", () => {
    const parsed = parseEnv(Object.fromEntries(assigned));
    expect(parsed).toMatchObject({ NODE_ENV: "development", STUDIO_HOST: "localhost" });
    expect(siteRebuild(parsed)).toBe("off");
  });

  it("não carrega nada com cara de segredo de verdade", () => {
    expect(assigned.get("GITHUB_DISPATCH_TOKEN")).toBe("");
    expect(assigned.get("DATABASE_URL")).toContain("troque-esta-senha");
    for (const pattern of [/ghp_/, /github_pat_/, /sk-/, /AKIA/, /BEGIN [A-Z ]*PRIVATE KEY/]) {
      expect(pattern.test(text), String(pattern)).toBe(false);
    }
    // Example addresses only.
    for (const address of text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []) {
      expect(address.endsWith("@example.com") || address.includes("@127.0.0.1"), address).toBe(true);
    }
  });
});
