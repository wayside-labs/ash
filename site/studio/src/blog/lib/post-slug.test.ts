import { readFileSync } from "node:fs";
import { postSlug } from "./post-slug";

// The same pattern as the blog_posts_slug_chk constraint.
const DB_CHECK = /^[a-z0-9][a-z0-9-]{0,118}[a-z0-9]$/;

describe("postSlug", () => {
  it("converte título em kebab-case sem acentos", () => {
    expect(postSlug("Quanto custa um agente pagar sozinho?")).toBe(
      "quanto-custa-um-agente-pagar-sozinho",
    );
    expect(postSlug("Orçamento, nunca a chave!")).toBe("orcamento-nunca-a-chave");
  });

  it("remove acentos e cedilha sem perder a letra", () => {
    expect(postSlug("Precificação de serviços de automação")).toBe(
      "precificacao-de-servicos-de-automacao",
    );
    expect(postSlug("Reunião")).toBe("reuniao");
  });

  it("colapsa separadores repetidos e apara bordas", () => {
    expect(postSlug("  --Olá,   mundo!--  ")).toBe("ola-mundo");
  });

  it("trunca em 120 caracteres sem cortar no hífen", () => {
    const slug = postSlug("a".repeat(200));
    expect(slug.length).toBeLessThanOrEqual(120);
    expect(slug.endsWith("-")).toBe(false);
    expect(postSlug(`${"a".repeat(119)} bcd`)).toBe("a".repeat(119));
  });

  it("vira 'post' quando não sobra nada", () => {
    expect(postSlug("!!!")).toBe("post");
    expect(postSlug("")).toBe("post");
  });

  it("vira 'post' quando sobra menos de 2 caracteres (o CHECK do banco exige 2)", () => {
    expect(postSlug("!!!!!!! a")).toBe("post");
    expect(postSlug("ab")).toBe("ab");
  });

  it("a saída sempre passa no CHECK de slug do banco", () => {
    for (const title of ["", "a", "!!!", "Olá", "x".repeat(500), "a - b", "日本語のタイトル", "-- 1 --"]) {
      expect(postSlug(title), title).toMatch(DB_CHECK);
    }
  });

  it("o fonte não carrega os bytes dos acentos: a faixa é escrita com escapes", () => {
    // Raw combining marks in a regex are invisible in an editor and easy to lose in a copy.
    const source = readFileSync(new URL("./post-slug.ts", import.meta.url), "utf8");
    expect([...source].every((c) => c.charCodeAt(0) < 128)).toBe(true);
    expect(source).toContain("u0300-");
  });
});
