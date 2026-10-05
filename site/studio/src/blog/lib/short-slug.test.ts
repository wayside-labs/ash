import { UpsertAuthorSchema, UpsertCategorySchema } from "../schemas";
import { isShortSlug, suggestShortSlug } from "./short-slug";

describe("isShortSlug", () => {
  const cases: [string, boolean][] = [
    ["produto", true],
    ["ab", true],
    ["a1", true],
    ["guia-de-pagamentos", true],
    ["a".repeat(60), true],
    ["a".repeat(61), false],
    ["a", false],
    ["", false],
    ["-produto", false],
    ["produto-", false],
    ["Produto", false],
    ["produção", false],
    ["duas palavras", false],
    ["com_sublinhado", false],
    ["com/barra", false],
    [" produto", false],
  ];
  for (const [value, expected] of cases) {
    it(`${JSON.stringify(value.length > 20 ? `${value.slice(0, 5)}… (${value.length})` : value)} → ${expected}`, () => {
      expect(isShortSlug(value)).toBe(expected);
    });
  }

  it("diz o mesmo que os dois schemas, de categoria e de autor", () => {
    for (const [value, expected] of cases) {
      const category = UpsertCategorySchema.safeParse({ slug: value, name_pt: "Nome", name_en: "Name" });
      const author = UpsertAuthorSchema.safeParse({ slug: value, name: "Nome" });
      expect(category.success, `categoria ${value}`).toBe(expected);
      expect(author.success, `autor ${value}`).toBe(expected);
    }
  });
});

describe("suggestShortSlug", () => {
  it("tira acento, espaço e pontuação", () => {
    expect(suggestShortSlug("Produção & Segurança")).toBe("producao-seguranca");
    expect(suggestShortSlug("  Guia  ")).toBe("guia");
  });

  it("corta em 60 sem deixar hífen no fim, e o resultado é válido", () => {
    const long = suggestShortSlug(`${"palavra ".repeat(7)}fim e mais um pouco de texto`);
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith("-")).toBe(false);
    expect(isShortSlug(long)).toBe(true);
  });

  it("um nome sem letra nenhuma dá vazio, e o formulário é quem reclama", () => {
    expect(suggestShortSlug("!!!")).toBe("");
    expect(isShortSlug(suggestShortSlug("!!!"))).toBe(false);
  });
});
