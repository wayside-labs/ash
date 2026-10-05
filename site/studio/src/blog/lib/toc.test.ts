// withToc and sanitizePostHtml are tested together on purpose: the id that one injects has to
// survive the other on serve, and neither suite alone would catch that coupling.
import { HOSTILE_INPUT_BUDGET_MS } from "../../../tests/helpers/timing";
import { sanitizePostHtml } from "./sanitize";
import { withToc } from "./toc";

describe("withToc", () => {
  it("decodifica entidades no texto do item e no slug; o html fica como estava", () => {
    const { html, items } = withToc("<h2>Tom &amp; Jerry</h2>");
    expect(items).toEqual([{ id: "tom-jerry", text: "Tom & Jerry", level: 2 }]);
    expect(html).toBe('<h2 id="tom-jerry">Tom &amp; Jerry</h2>');
  });

  it("o texto do item é texto puro: o que era &lt; vira o caractere, não uma tag", () => {
    const { html, items } = withToc("<h2>A tag &lt;script&gt; e &quot;aspas&quot; e &#39;isto&#39;</h2>");
    expect(items[0]?.text).toBe("A tag <script> e \"aspas\" e 'isto'");
    expect(items[0]?.id).toBe("a-tag-script-e-aspas-e-isto");
    expect(html).not.toContain("<script>");
  });

  it("entidades numéricas e &nbsp; também", () => {
    const { items } = withToc("<h2>Caf&#233;&nbsp;com&#x20;leite</h2><h3>&amp;amp;</h3>");
    expect(items.map((i) => [i.text, i.id])).toEqual([
      ["Café com leite", "cafe-com-leite"],
      ["&amp;", "amp"],
    ]);
  });

  it("título só de &nbsp; é vazio: não vira item", () => {
    const html = "<h2>&nbsp;</h2><h2> &#160; </h2>";
    expect(withToc(html)).toEqual({ html, items: [] });
  });

  it("cabeçalho dentro de cabeçalho: só o de fora vira item, com o texto dos dois", () => {
    // What the sanitizer produces from unclosed headings. Pinned, not designed: the inner
    // heading gets no id and no entry.
    const nested = withToc("<h2>a<h2>b</h2></h2><h2>c<h3>d</h3>e</h2>");
    expect(nested.items.map((i) => [i.level, i.text, i.id])).toEqual([
      [2, "ab", "ab"],
      [2, "cde", "cde"],
    ]);
    expect(nested.html).toBe('<h2 id="ab">a<h2>b</h2></h2><h2 id="cde">c<h3>d</h3>e</h2>');
  });

  it("cabeçalho que nunca fecha fica como está, e o que veio antes ganha id", () => {
    expect(withToc("<h2>sem fim<p>x</p>")).toEqual({ html: "<h2>sem fim<p>x</p>", items: [] });
    const { html, items } = withToc("<h2>Um</h2><h3>sem fim");
    expect(items.map((i) => i.id)).toEqual(["um"]);
    expect(html).toBe('<h2 id="um">Um</h2><h3>sem fim');
  });

  it("id do autor sai em qualquer grafia", () => {
    for (const heading of [
      "<h2 ID='x'>Titulo</h2>",
      "<h2 id = x>Titulo</h2>",
      '<h2  id="x"  id="y">Titulo</h2>',
    ]) {
      const { html } = withToc(heading);
      expect(html, heading).not.toMatch(/[xy]/);
      expect((html.match(/id=/gi) ?? []).length, heading).toBe(1);
      expect(html, heading).toContain('id="titulo"');
    }
  });

  it("entrada hostil no teto do corpo termina rápido", () => {
    const cap = 300_000;
    const fill = (unit: string) => unit.repeat(Math.floor(cap / unit.length));
    const depth = Math.floor(cap / 10);
    const inputs: [string, string][] = [
      ["h2 aberto sem fechar", fill("<h2>x")],
      ["h2 aninhado, como o sanitizador devolve", "<h2>x".repeat(depth) + "</h2>".repeat(depth)],
      ["só aberturas", fill("<h2>")],
      ["abertura sem fim", fill("<h2 ")],
      ["títulos iguais", fill("<h2>x</h2>")],
      ["títulos iguais longos", fill("<h2>Como funciona</h2>")],
      ["id sem valor", fill("<h2 id=")],
      ["espaços no atributo", `<h2${" ".repeat(cap)}>x</h2>`],
      ["espaços e id no atributo", `<h2${" id".repeat(cap / 3)}>x</h2>`],
      ["entidades", `<h2>${fill("&amp;")}</h2>`],
      ["sinais de menor", fill("<")],
    ];
    for (const [name, input] of inputs) {
      const start = performance.now();
      withToc(input);
      expect(performance.now() - start, name).toBeLessThan(HOSTILE_INPUT_BUDGET_MS);
    }
  });

  it("acha os h2 e h3, na ordem em que aparecem", () => {
    const { items } = withToc("<h2>Primeira</h2><p>x</p><h3>Detalhe</h3><h2>Segunda</h2>");
    expect(items.map((i) => [i.level, i.text])).toEqual([
      [2, "Primeira"],
      [3, "Detalhe"],
      [2, "Segunda"],
    ]);
  });

  it("a âncora sai do texto, sem acento", () => {
    const { html, items } = withToc("<h2>Não é só código</h2>");
    expect(items[0]?.id).toBe("nao-e-so-codigo");
    expect(html).toBe('<h2 id="nao-e-so-codigo">Não é só código</h2>');
  });

  it("tira a marcação de dentro do título", () => {
    const { items } = withToc("<h2>O <strong>ponto</strong> central</h2>");
    expect(items[0]?.text).toBe("O ponto central");
    expect(items[0]?.id).toBe("o-ponto-central");
  });

  it("dois títulos iguais não ganham o mesmo id", () => {
    // Without the suffix the second link would lead to the first heading, silently.
    const { items } = withToc("<h2>Como funciona</h2><h2>Como funciona</h2><h3>Como funciona</h3>");
    expect(items.map((i) => i.id)).toEqual(["como-funciona", "como-funciona-2", "como-funciona-3"]);
  });

  it("o sufixo não colide com um título que já termina em número", () => {
    const { items } = withToc("<h2>Passo</h2><h2>Passo 2</h2><h2>Passo</h2>");
    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("título só de símbolos ainda ganha um id válido e único", () => {
    const { html, items } = withToc("<h2>!!!</h2><h2>???</h2>");
    expect(items.map((i) => i.id)).toEqual(["secao", "secao-2"]);
    expect(html).toContain('<h2 id="secao">!!!</h2>');
  });

  it("título de um caractere só também cai em 'secao'", () => {
    expect(withToc("<h2>B</h2>").items[0]?.id).toBe("secao");
    expect(withToc("<h2>Ab</h2>").items[0]?.id).toBe("ab");
  });

  it("um título chamado Post fica com o próprio slug, não com o reserva", () => {
    expect(withToc("<h2>Post</h2><h2>!!!</h2>").items.map((i) => i.id)).toEqual(["post", "secao"]);
  });

  it("cabeçalho vazio não vira item nem ganha id", () => {
    const { html, items } = withToc("<h2></h2><h2>Real</h2>");
    expect(items).toHaveLength(1);
    expect(html).toContain("<h2></h2>");
  });

  it("id que o autor tenha escrito é descartado, e não somado", () => {
    // With two ids on one element the browser uses the first: the link would point at the
    // author's. This is what makes it safe for the sanitizer to accept id on headings.
    const { html, items } = withToc('<h2 id="escolhido-por-mim">Titulo</h2>');
    expect(html).not.toContain("escolhido-por-mim");
    expect(html).toContain(`id="${items[0]?.id}"`);
    expect((html.match(/id=/g) ?? []).length, "sobrou mais de um id").toBe(1);
  });

  it("h4 e h1 não entram no sumário", () => {
    const { html, items } = withToc("<h4>Menor</h4><h2>Seção</h2>");
    expect(items.map((i) => i.text)).toEqual(["Seção"]);
    expect(html).toContain("<h4>Menor</h4>");
  });

  it("rodar de novo sobre a própria saída não muda nada", () => {
    const first = withToc("<h2>Uma seção</h2><p>t</p><h3>Outra</h3><h2>Uma seção</h2>");
    const second = withToc(first.html);
    expect(second).toEqual(first);
  });

  it("corpo sem cabeçalho devolve lista vazia e o html intacto", () => {
    const html = "<p>Um paragrafo so.</p>";
    expect(withToc(html)).toEqual({ html, items: [] });
  });
});

describe("a âncora sobrevive ao sanitizador", () => {
  it("o id do sumário continua lá depois de sanitizar de novo", () => {
    // The real path: the body is sanitized, gets its anchors, and is sanitized again on serve.
    const { html, items } = withToc(sanitizePostHtml("<h2>Uma seção</h2><p>texto</p>"));
    const after = sanitizePostHtml(html);

    expect(items[0]?.id).toBe("uma-secao");
    expect(after, "a âncora foi removida ao servir").toContain('id="uma-secao"');
  });

  it("id forjado pelo autor não chega ao DOM pelo caminho real", () => {
    const { html } = withToc(sanitizePostHtml('<h2 id="admin-form">Seção</h2><h3 id="x">B</h3>'));
    const after = sanitizePostHtml(html);
    expect(after).toBe('<h2 id="secao">Seção</h2><h3 id="secao-2">B</h3>');
  });
});
