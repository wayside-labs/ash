import { HOSTILE_INPUT_BUDGET_MS } from "../../../tests/helpers/timing";
import { SHORTCODE_LABELS, editorHtmlToStored, storedHtmlToEditor } from "./shortcode-html";
import { KNOWN_SHORTCODES, validateShortcodes } from "./shortcodes";

describe("storedHtmlToEditor", () => {
  it("troca shortcode por span com data-shortcode", () => {
    expect(storedHtmlToEditor("<p>Veja:</p>{{mapa}}")).toBe(
      '<p>Veja:</p><span data-shortcode="mapa"></span>',
    );
  });

  it("converte vários shortcodes na mesma passagem", () => {
    expect(storedHtmlToEditor("{{cta:pitch}}<p>x</p>{{cta:newsletter}}")).toBe(
      '<span data-shortcode="cta:pitch"></span><p>x</p><span data-shortcode="cta:newsletter"></span>',
    );
  });

  it("converte nome com argumento", () => {
    expect(storedHtmlToEditor("{{cta:contato}}")).toBe('<span data-shortcode="cta:contato"></span>');
  });

  it("deixa HTML sem shortcode intacto", () => {
    expect(storedHtmlToEditor("<p>nada aqui</p>")).toBe("<p>nada aqui</p>");
  });
});

describe("editorHtmlToStored", () => {
  it("troca span de volta por shortcode", () => {
    expect(editorHtmlToStored('<p>Veja:</p><span data-shortcode="mapa"></span>')).toBe(
      "<p>Veja:</p>{{mapa}}",
    );
  });

  it("aceita atributos extras que o TipTap adiciona no span", () => {
    expect(
      editorHtmlToStored(
        '<span class="shortcode-chip" data-shortcode="cta:pitch" contenteditable="false"></span>',
      ),
    ).toBe("{{cta:pitch}}");
  });

  it("aceita o span com o rótulo dentro, que é como o editor o devolve", () => {
    // The node renders ["span", attrs, label], so getHTML() emits the label as text. boringco's
    // regex only matched an empty span: the span was then stripped by the sanitizer and the
    // label stayed in the post as plain text, with the shortcode gone.
    for (const name of KNOWN_SHORTCODES) {
      const html = `<p>a</p><span data-shortcode="${name}">${SHORTCODE_LABELS[name]}</span><p>b</p>`;
      expect(editorHtmlToStored(html), name).toBe(`<p>a</p>{{${name}}}<p>b</p>`);
    }
  });

  it("aceita rótulo com quebra de linha e espaços em volta", () => {
    expect(editorHtmlToStored('<span data-shortcode="mapa">\n  Mapa do fluxo\n</span>')).toBe(
      "{{mapa}}",
    );
  });

  it("dois spans seguidos viram dois shortcodes, sem engolir o que há entre eles", () => {
    expect(
      editorHtmlToStored(
        '<span data-shortcode="mapa">Mapa</span><p>meio</p><span data-shortcode="cta:pitch">CTA</span>',
      ),
    ).toBe("{{mapa}}<p>meio</p>{{cta:pitch}}");
  });

  it("span comum, sem data-shortcode, fica como está", () => {
    expect(editorHtmlToStored("<p><span>texto</span></p>")).toBe("<p><span>texto</span></p>");
  });

  it("só troca quando o nome segue a gramática do shortcode", () => {
    // The name goes into the stored body between braces: anything outside the grammar would be
    // text the author never typed, injected by an attribute.
    for (const html of [
      '<span data-shortcode="x}}<script>">CTA</span>',
      '<span data-shortcode="x}}">CTA</span>',
      '<span data-shortcode="MAPA">Mapa</span>',
      '<span data-shortcode="mapa ">Mapa</span>',
      '<span data-shortcode="cta:">CTA</span>',
      '<span data-shortcode=":pitch">CTA</span>',
      '<span data-shortcode="cta:pitch:x">CTA</span>',
      '<span data-shortcode="">vazio</span>',
      '<span data-shortcode>sem valor</span>',
    ]) {
      expect(editorHtmlToStored(html), html).toBe(html);
    }
  });

  it("nome gramatical mas fora do catálogo é trocado: quem recusa é o validateShortcodes", () => {
    const stored = editorHtmlToStored('<span data-shortcode="banner:topo">Banner</span>');
    expect(stored).toBe("{{banner:topo}}");
    expect(validateShortcodes(stored).unknown).toEqual(["banner:topo"]);
  });

  it("não confunde outro atributo que termina em data-shortcode", () => {
    const html = '<span xdata-shortcode="mapa">Mapa</span>';
    expect(editorHtmlToStored(html)).toBe(html);
  });

  it("span com outra tag dentro não é um chip de shortcode", () => {
    const html = '<span data-shortcode="mapa"><strong>Mapa</strong></span>';
    expect(editorHtmlToStored(html)).toBe(html);
  });

  it("entrada hostil termina rápido, inclusive no teto do corpo", () => {
    const small = '<span data-shortcode="x'.repeat(1000);
    const start = performance.now();
    expect(editorHtmlToStored(small)).toBe(small);
    expect(performance.now() - start).toBeLessThan(HOSTILE_INPUT_BUDGET_MS);

    for (const unit of [
      '<span data-shortcode="x',
      "<span ",
      "<span",
      '<span data-shortcode="mapa">',
      '<span data-shortcode="mapa">a',
      '<span a="b" ',
      "</span>",
      '"',
    ]) {
      const input = unit.repeat(Math.floor(300_000 / unit.length));
      const from = performance.now();
      editorHtmlToStored(input);
      expect(performance.now() - from, unit).toBeLessThan(HOSTILE_INPUT_BUDGET_MS);
    }
  });

  it("é o inverso do storedHtmlToEditor", () => {
    const original = "<h2>Oi</h2><p>t</p>{{cta:pitch}}<p>fim</p>{{mapa}}";
    expect(editorHtmlToStored(storedHtmlToEditor(original))).toBe(original);
  });

  it("o que volta do editor passa na validação de nível de bloco", () => {
    const stored = editorHtmlToStored(
      '<p>a</p><span data-shortcode="cta:newsletter">CTA: newsletter</span><p>b</p>',
    );
    expect(validateShortcodes(stored)).toEqual({ ok: true, unknown: [], inline: [] });
  });
});

describe("SHORTCODE_LABELS", () => {
  it("tem rótulo legível para cada shortcode conhecido, e só para eles", () => {
    expect(Object.keys(SHORTCODE_LABELS).sort()).toEqual([...KNOWN_SHORTCODES].sort());
    for (const name of KNOWN_SHORTCODES) {
      expect(SHORTCODE_LABELS[name].trim().length, name).toBeGreaterThan(0);
      // The label is emitted as the span's text; a "<" in it would stop the span from matching.
      expect(SHORTCODE_LABELS[name], name).not.toMatch(/[<>&]/);
    }
    expect(SHORTCODE_LABELS.mapa).toBe("Mapa do fluxo");
    expect(SHORTCODE_LABELS["cta:pitch"]).toBe("CTA: pitch");
  });
});
