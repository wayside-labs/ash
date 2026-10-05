import { type BlogQuery, blogHref, parseBlogQuery } from "./list-query";

const DEFAULT: BlogQuery = { view: "posts", lang: null, status: null };

describe("parseBlogQuery", () => {
  const cases: [string, Record<string, string | string[] | undefined>, BlogQuery][] = [
    ["vazio", {}, DEFAULT],
    ["view posts", { view: "posts" }, DEFAULT],
    ["view revisao", { view: "revisao" }, { ...DEFAULT, view: "revisao" }],
    ["view agendados", { view: "agendados" }, { ...DEFAULT, view: "agendados" }],
    ["idioma", { lang: "en" }, { ...DEFAULT, lang: "en" }],
    ["estado", { status: "publicado" }, { ...DEFAULT, status: "publicado" }],
    [
      "idioma e estado juntos",
      { view: "posts", lang: "pt", status: "rascunho" },
      { view: "posts", lang: "pt", status: "rascunho" },
    ],
    // The filters belong to the posts tab: the other two have a fixed meaning.
    [
      "filtros fora da aba de posts são ignorados",
      { view: "revisao", lang: "pt", status: "publicado" },
      { ...DEFAULT, view: "revisao" },
    ],
    ["view desconhecida", { view: "campanhas" }, DEFAULT],
    ["view em maiúsculas", { view: "REVISAO" }, DEFAULT],
    ["view com espaço", { view: " revisao" }, DEFAULT],
    ["view repetida vira lista", { view: ["revisao", "agendados"] }, DEFAULT],
    ["view vazia", { view: "" }, DEFAULT],
    ["idioma desconhecido", { lang: "es" }, DEFAULT],
    ["idioma repetido", { lang: ["pt", "en"] }, DEFAULT],
    ["estado desconhecido", { status: "pauta" }, DEFAULT],
    ["estado com SQL", { status: "publicado' or 1=1 --" }, DEFAULT],
    ["nome de propriedade herdada", { view: "constructor", status: "__proto__" }, DEFAULT],
    ["outra propriedade herdada", { view: "toString", lang: "hasOwnProperty" }, DEFAULT],
    ["undefined explícito", { view: undefined, lang: undefined, status: undefined }, DEFAULT],
    ["parâmetros que não são nossos", { page: "7", q: "<script>" }, DEFAULT],
    [
      "um valor ruim não derruba os outros",
      { view: "posts", lang: "xx", status: "aprovado" },
      { ...DEFAULT, status: "aprovado" },
    ],
  ];
  for (const [label, raw, expected] of cases) {
    it(label, () => {
      expect(parseBlogQuery(raw)).toEqual(expected);
    });
  }

  it("nunca lança, nem com um objeto sem protótipo ou com valores de outro tipo", () => {
    const bare = Object.create(null) as Record<string, string>;
    bare.view = "agendados";
    expect(parseBlogQuery(bare)).toEqual({ ...DEFAULT, view: "agendados" });
    const wrong = { view: 3, lang: null, status: {} } as unknown as Record<string, string>;
    expect(parseBlogQuery(wrong)).toEqual(DEFAULT);
  });
});

describe("blogHref", () => {
  it("o padrão é a URL limpa", () => {
    expect(blogHref({})).toBe("/blog");
    expect(blogHref(DEFAULT)).toBe("/blog");
  });

  it("só escreve o que foge do padrão, em ordem fixa", () => {
    expect(blogHref({ view: "revisao" })).toBe("/blog?view=revisao");
    expect(blogHref({ lang: "en" })).toBe("/blog?lang=en");
    expect(blogHref({ status: "aprovado", lang: "pt" })).toBe("/blog?lang=pt&status=aprovado");
  });

  it("fora da aba de posts os filtros não vão para a URL", () => {
    expect(blogHref({ view: "agendados", lang: "pt", status: "aprovado" })).toBe(
      "/blog?view=agendados",
    );
  });

  it("o que escreve, parseBlogQuery lê de volta", () => {
    const query: BlogQuery = { view: "posts", lang: "en", status: "rejeitado" };
    const params = new URL(blogHref(query), "https://studio.example").searchParams;
    expect(parseBlogQuery(Object.fromEntries(params))).toEqual(query);
  });
});
