import { HOSTILE_INPUT_BUDGET_MS } from "../../../tests/helpers/timing";
import { MAX_BODY_HTML_LENGTH, hasBodyContent, stripTags } from "./body-content";

const NBSP = String.fromCharCode(160);
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
const ZERO_WIDTH_JOINER = String.fromCharCode(0x200d);
const BOM = String.fromCharCode(0xfeff);

const fill = (unit: string) => unit.repeat(Math.floor(MAX_BODY_HTML_LENGTH / unit.length));

describe("stripTags", () => {
  it("troca cada tag pelo que for pedido", () => {
    expect(stripTags("<p>a<br />b</p>", " ")).toBe(" a b ");
    expect(stripTags("Sub<em>título</em>", "")).toBe("Subtítulo");
    expect(stripTags("sem tag", " ")).toBe("sem tag");
  });

  it("entrada hostil no teto do corpo termina rápido", () => {
    for (const unit of ["<", "<a", "<<>", "< ", "<p>x"]) {
      const input = fill(unit);
      const start = performance.now();
      stripTags(input, " ");
      expect(performance.now() - start, unit).toBeLessThan(HOSTILE_INPUT_BUDGET_MS);
    }
  });
});

describe("hasBodyContent", () => {
  it("o teto do corpo é 300 mil caracteres", () => {
    expect(MAX_BODY_HTML_LENGTH).toBe(300_000);
  });

  it("caracteres de largura zero não são conteúdo", () => {
    for (const html of [
      "<p>&#8203;</p>",
      "<p>&#x200B;</p>",
      "<p>&#x200b;&#8204;&#8205;&#8288;</p>",
      "<p>&#65279;</p>",
      "<p>&#xFEFF;</p>",
      `<p>${ZERO_WIDTH_SPACE}</p>`,
      `<p>${ZERO_WIDTH_JOINER}</p>`,
      `<p>${BOM}</p>`,
      `<p>${ZERO_WIDTH_SPACE} &nbsp;${BOM}&#8203;</p><p></p>`,
    ]) {
      expect(hasBodyContent(html), JSON.stringify(html)).toBe(false);
    }
    expect(hasBodyContent(`<p>a${ZERO_WIDTH_SPACE}</p>`)).toBe(true);
  });

  it("entrada hostil no teto do corpo termina rápido", () => {
    for (const unit of ["<", "<p>", "&#8203;", "&nbsp;", " ", "&#", ZERO_WIDTH_SPACE]) {
      const input = fill(unit);
      const start = performance.now();
      expect(hasBodyContent(input), unit).toBe(unit === "<" || unit === "&#");
      expect(performance.now() - start, unit).toBeLessThan(HOSTILE_INPUT_BUDGET_MS);
    }
  });

  it("o documento vazio do editor não é conteúdo", () => {
    for (const html of [
      "",
      "   ",
      "\n\t",
      "<p></p>",
      "<p> </p>",
      "<p></p><p></p>",
      "<p><br></p>",
      "<p><br /></p>",
      "<p>&nbsp;</p>",
      "<p>&#160;</p>",
      "<p>&#xA0;</p>",
      `<p>${NBSP}</p>`,
      "<p> &nbsp; </p>\n<p></p>",
    ]) {
      expect(hasBodyContent(html), JSON.stringify(html)).toBe(false);
    }
  });

  it("tags vazias, sozinhas ou aninhadas, não são conteúdo", () => {
    for (const html of [
      "<h2></h2>",
      "<ul><li></li></ul>",
      "<blockquote><p></p></blockquote>",
      "<p><strong></strong><em> </em></p>",
      "<table><tbody><tr><td></td></tr></tbody></table>",
      "<hr>",
      "<p></p><hr /><p></p>",
    ]) {
      expect(hasBodyContent(html), html).toBe(false);
    }
  });

  it("texto é conteúdo", () => {
    for (const html of ["<p>a</p>", "texto solto", "<h2>Título</h2>", "<p>&amp;</p>", "<p>1 &lt; 2</p>"]) {
      expect(hasBodyContent(html), html).toBe(true);
    }
  });

  it("corpo só com imagem é conteúdo", () => {
    expect(hasBodyContent('<img src="/media/posts/novo/a.webp" alt="">')).toBe(true);
    expect(hasBodyContent('<figure><img src="/media/a.webp" alt="A" /></figure>')).toBe(true);
    expect(hasBodyContent('<p></p><img src="/media/a.webp"><p></p>')).toBe(true);
  });

  it("corpo só com shortcode é conteúdo", () => {
    expect(hasBodyContent("{{mapa}}")).toBe(true);
    expect(hasBodyContent("<p></p>{{cta:pitch}}<p></p>")).toBe(true);
  });
});
