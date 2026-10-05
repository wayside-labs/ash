import { HOSTILE_INPUT_BUDGET_MS } from "../../../tests/helpers/timing";
import { KNOWN_SHORTCODES, parseShortcodes, validateShortcodes } from "./shortcodes";

describe("parseShortcodes", () => {
  it("divide o HTML em segmentos html/shortcode na ordem", () => {
    expect(parseShortcodes("<p>Antes</p>{{mapa}}<p>Depois</p>")).toEqual([
      { type: "html", html: "<p>Antes</p>" },
      { type: "shortcode", name: "mapa" },
      { type: "html", html: "<p>Depois</p>" },
    ]);
  });

  it("mantém o nome inteiro, com o que vem depois dos dois-pontos", () => {
    expect(parseShortcodes("{{cta:pitch}}{{cta:newsletter}}")).toEqual([
      { type: "shortcode", name: "cta:pitch" },
      { type: "shortcode", name: "cta:newsletter" },
    ]);
  });

  it("print não é caso especial: sai como qualquer outro nome, sem argumento", () => {
    expect(parseShortcodes("{{print:agenda-semana}}")).toEqual([
      { type: "shortcode", name: "print:agenda-semana" },
    ]);
  });

  it("html sem shortcode vira um segmento único", () => {
    expect(parseShortcodes("<p>Só texto</p>")).toEqual([{ type: "html", html: "<p>Só texto</p>" }]);
  });

  it("corpo vazio não tem segmento", () => {
    expect(parseShortcodes("")).toEqual([]);
  });

  it("ignora chaves malformadas", () => {
    for (const html of ["<p>{{nao fecha</p>", "<p>{{ mapa }}</p>", "<p>{{MAPA}}</p>", "<p>{mapa}</p>"]) {
      expect(parseShortcodes(html), html).toEqual([{ type: "html", html }]);
    }
  });
});

describe("validateShortcodes", () => {
  it("o catálogo é o do Ash", () => {
    expect([...KNOWN_SHORTCODES]).toEqual(["cta:pitch", "cta:newsletter", "cta:contato", "mapa"]);
  });

  it("aceita os shortcodes conhecidos em nível de bloco", () => {
    const r = validateShortcodes(
      "{{cta:pitch}}<p>a</p>{{cta:newsletter}}<h2>b</h2>{{cta:contato}}<hr />{{mapa}}",
    );
    expect(r).toEqual({ ok: true, unknown: [], inline: [] });
  });

  it("corpo sem shortcode é válido", () => {
    expect(validateShortcodes("<p>Só texto</p>")).toEqual({ ok: true, unknown: [], inline: [] });
  });

  it("aponta shortcodes desconhecidos", () => {
    const r = validateShortcodes("{{cta:comprar-agora}}{{banner:topo}}");
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(["cta:comprar-agora", "banner:topo"]);
  });

  it("print e os shortcodes do boringco não existem aqui", () => {
    const r = validateShortcodes("{{print:foto}}{{calculadora:furo}}{{cta:gratis}}{{cta:afiliadas}}");
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(["print:foto", "calculadora:furo", "cta:gratis", "cta:afiliadas"]);
  });

  it("recusa shortcode dentro de <p>", () => {
    // parseShortcodes cuts the body at the shortcode: inside a paragraph that leaves "<p>Veja"
    // and "</p>" as two halves, each injected as HTML on its own.
    const r = validateShortcodes("<p>Veja {{cta:pitch}}</p>");
    expect(r).toEqual({ ok: false, unknown: [], inline: ["cta:pitch"] });
    expect(validateShortcodes("<p>{{mapa}}</p>").inline).toEqual(["mapa"]);
  });

  it("recusa shortcode dentro de qualquer outro elemento", () => {
    for (const html of [
      "<ul><li>{{mapa}}</li></ul>",
      "<blockquote><p>a</p>{{mapa}}</blockquote>",
      "<h2>{{mapa}}</h2>",
      "<p><strong>{{mapa}}</strong></p>",
      "<table><tbody><tr><td>{{mapa}}</td></tr></tbody></table>",
    ]) {
      expect(validateShortcodes(html), html).toEqual({ ok: false, unknown: [], inline: ["mapa"] });
    }
  });

  it("recusa shortcode dentro de atributo", () => {
    const r = validateShortcodes('<a href="/x" title="{{mapa}}">l</a>');
    expect(r.ok).toBe(false);
    expect(r.inline).toEqual(["mapa"]);
  });

  it("tags vazias (br, hr, img) antes do shortcode não o tornam aninhado", () => {
    for (const html of [
      "<hr />{{mapa}}",
      "<hr>{{mapa}}",
      '<img src="/media/a.webp" alt="A" />{{mapa}}',
      "<p>a<br />b</p>{{mapa}}",
    ]) {
      expect(validateShortcodes(html), html).toEqual({ ok: true, unknown: [], inline: [] });
    }
  });

  it("separa o aninhado do desconhecido, e aponta os dois", () => {
    const r = validateShortcodes("<p>{{cta:pitch}}</p>{{banner:topo}}<p>{{outro}}</p>{{mapa}}");
    expect(r.ok).toBe(false);
    expect(r.unknown).toEqual(["banner:topo", "outro"]);
    expect(r.inline).toEqual(["cta:pitch", "outro"]);
  });

  it("entrada hostil no teto do corpo termina rápido", () => {
    for (const unit of [
      "<p></p>{{mapa}}",
      "{{mapa}}",
      "<p>{{mapa}}</p>",
      "<",
      "<a",
      "{{",
      "{{a",
      "{{a:",
      "<p>",
      "</p>",
    ]) {
      const input = unit.repeat(Math.floor(300_000 / unit.length));
      const start = performance.now();
      validateShortcodes(input);
      parseShortcodes(input);
      expect(performance.now() - start, unit).toBeLessThan(HOSTILE_INPUT_BUDGET_MS);
    }
  });
});
