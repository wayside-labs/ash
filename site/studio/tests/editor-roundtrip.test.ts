// @vitest-environment jsdom
// The test M1a's decision 7 deferred: the editor's real schema against the real sanitizer and
// shortcode libs. What the admin sees in the editor must be what is stored, and what is stored
// must load back as the same document; otherwise formatting vanishes on save with no error.
import { Editor } from "@tiptap/core";
import {
  editorExtensions,
  editorToStored,
  hasUnsupportedMarkup,
  insertBlock,
  storedToEditor,
} from "@/blog/components/editor/extensions";
import { MAX_BODY_HTML_LENGTH, hasBodyContent } from "@/blog/lib/body-content";
import { ALLOWED_TAGS, sanitizePostHtml } from "@/blog/lib/sanitize";
import { SHORTCODE_LABELS } from "@/blog/lib/shortcode-html";
import { KNOWN_SHORTCODES, validateShortcodes } from "@/blog/lib/shortcodes";
import { installEditorDomStubs } from "./helpers/dom";
import { HOSTILE_INPUT_BUDGET_MS } from "./helpers/timing";

let editor: Editor;
beforeAll(() => {
  editor = new Editor({ extensions: editorExtensions, content: "<p></p>" });
});
afterAll(() => editor.destroy());

// What the server does with the editor's document (posts.ts, prepare): convert, then sanitize.
const savePath = () => sanitizePostHtml(editorToStored(editor.getHTML()));

// stored -> editor -> stored, as the editor page does on load and the save button on click.
function roundTrip(stored: string): string {
  editor.commands.setContent(storedToEditor(stored));
  return savePath();
}

// Whatever is put into the editor from outside (paste, drop) goes through the same parser.
function pasted(html: string): string {
  editor.commands.setContent(html);
  return savePath();
}

const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const census = (html: string) => ({
  shortcodes: count(html, /\{\{[a-z]+(?::[a-z0-9-]+)?\}\}/g),
  images: count(html, /<img\b/g),
  links: count(html, /<a href=/g),
  h2: count(html, /<h2\b/g),
  h3: count(html, /<h3\b/g),
  h4: count(html, /<h4\b/g),
  items: count(html, /<li\b/g),
  quotes: count(html, /<blockquote\b/g),
  code: count(html, /<code\b/g),
  pre: count(html, /<pre\b/g),
  rules: count(html, /<hr\b/g),
  breaks: count(html, /<br\b/g),
  strong: count(html, /<strong\b/g),
  em: count(html, /<em\b/g),
  del: count(html, /<del\b/g),
});

const IMG = '<img src="/media/posts/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222.webp" alt="Um gráfico de barras" width="1600" height="900" />';
const ALL_SHORTCODES = KNOWN_SHORTCODES.map((name) => `{{${name}}}`).join("<p>entre um bloco e outro</p>");

const section = (n: number) =>
  `<h2>Seção ${n}</h2><p>Um parágrafo com <strong>negrito</strong>, <em>itálico</em> e um <a href="https://example.com/${n}">link</a>. ${"Texto corrido de um post de verdade. ".repeat(12).trim()}</p><h3>Detalhe ${n}</h3><ul><li><p>primeiro</p></li><li><p>segundo</p></li></ul>${IMG}{{cta:pitch}}`;

// Bodies as the database holds them, written the way the editor writes: for these the round
// trip must give back the very same string.
const CANONICAL: Record<string, string> = {
  "parágrafo com marcas": "<p>Texto com <strong>negrito</strong>, <em>itálico</em>, <del>riscado</del>, <code>código</code> e <strong><em>os dois</em></strong>.</p>",
  "links de cada tipo permitido":
    '<p><a href="https://example.com/a?b=1&amp;c=2">https</a> <a href="http://example.com">http</a> <a href="mailto:oi@example.com">e-mail</a> <a href="/pt/blog/outro-post">interno</a> <a href="#secao">âncora</a> <a href="https://example.com" title="Com título">título</a></p>',
  "títulos h2, h3 e h4": "<h2>Uma seção</h2><p>texto</p><h3>Uma subseção</h3><p>texto</p><h4>Um detalhe</h4><p>texto</p>",
  listas: "<ul><li><p>um</p></li><li><p>dois</p></li></ul><ol><li><p>primeiro</p></li><li><p>segundo</p></li></ol>",
  "listas aninhadas":
    "<ul><li><p>fora</p><ul><li><p>dentro</p><ol><li><p>mais dentro</p></li></ol></li></ul></li><li><p>fora de novo</p></li></ul>",
  citação: "<blockquote><p>Uma citação.</p><p>Em dois parágrafos.</p></blockquote>",
  "bloco de código": "<pre><code>const a = 1 &lt; 2 &amp;&amp; b &gt; 3;\nreturn a;</code></pre>",
  "linha divisória e quebra de linha": "<p>antes</p><hr /><p>uma linha<br />outra linha</p>",
  "imagem com texto alternativo": `<p>antes</p>${IMG}<p>depois</p>`,
  "imagem sem dimensões": '<img src="/media/posts/a/b.webp" alt="só o texto" /><p>depois</p>',
  "todos os shortcodes do catálogo, entre blocos": `<p>começo</p>${ALL_SHORTCODES}<p>fim</p>`,
  "shortcode e imagem no fim do corpo": `<p>texto</p>${IMG}{{mapa}}`,
  "shortcode no começo": "{{cta:newsletter}}<p>texto</p>",
  "entidades e aspas": '<p>Tom &amp; Jerry, 1 &lt; 2, "entre aspas" e apóstrofo.</p>',
  "acentos e outros alfabetos": "<p>Ação, coração, über, 日本語, emoji não, só texto.</p>",
  "documento vazio": "",
  "corpo do tamanho de um post longo": Array.from({ length: 60 }, (_, i) => section(i + 1)).join(""),
};

describe("ida e volta pelo editor", () => {
  it("o corpus é HTML que o sanitizador já devolve igual", () => {
    for (const [label, stored] of Object.entries(CANONICAL)) {
      expect(sanitizePostHtml(stored), label).toBe(stored);
    }
    // The long one is a real size, well inside the cap.
    const long = CANONICAL["corpo do tamanho de um post longo"] as string;
    expect(long.length).toBeGreaterThan(40_000);
    expect(long.length).toBeLessThan(MAX_BODY_HTML_LENGTH);
  });

  for (const [label, stored] of Object.entries(CANONICAL)) {
    it(`${label}: volta idêntico, e a segunda passada não muda nada`, () => {
      const once = roundTrip(stored);
      expect(once).toBe(stored);
      expect(census(once)).toEqual(census(stored));
      expect(roundTrip(once)).toBe(once);
      expect(validateShortcodes(once)).toEqual({ ok: true, unknown: [], inline: [] });
    });
  }

  // Bodies that are valid in the database but not written the editor's way (another tool wrote
  // them, or an older editor). The first pass may rewrite the markup; it may not lose anything,
  // and from then on it is stable.
  const FOREIGN: Record<string, string> = {
    "item de lista sem parágrafo": "<ul><li>um</li><li>dois<ul><li>dentro</li></ul></li></ul>",
    "imagem dentro de parágrafo": `<p>${IMG}</p><p>depois</p>`,
    "espaço e quebra de linha entre blocos": "<h2>Título</h2>\n\n<p>texto</p>\n<ul>\n<li>um</li>\n</ul>\n",
    "código com classe de linguagem (a classe não é guardada)": "<pre><code>x = 1</code></pre>",
    "marcas aninhadas em outra ordem": "<p><em><strong>os dois</strong></em> e <a href=\"/x\"><strong>link forte</strong></a></p>",
    "shortcodes colados um no outro": KNOWN_SHORTCODES.map((name) => `{{${name}}}`).join(""),
  };
  for (const [label, body] of Object.entries(FOREIGN)) {
    it(`${label}: nada se perde e a segunda passada é estável`, () => {
      const stored = sanitizePostHtml(body);
      const once = roundTrip(stored);
      expect(census(once)).toEqual(census(stored));
      expect(roundTrip(once)).toBe(once);
      expect(validateShortcodes(once).ok).toBe(true);
    });
  }

  it("o que o sanitizador aceita e o editor não tem: tabela e figura, e o editor sabe avisar", () => {
    const body = sanitizePostHtml(
      `<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table><figure>${IMG}<figcaption>legenda</figcaption></figure>`,
    );
    expect(body).toContain("<table>");
    expect(body).toContain("<figcaption>");
    expect(hasUnsupportedMarkup(body)).toBe(true);
    const once = roundTrip(body);
    // The text and the image survive; the structure does not. That is the loss the warning is for.
    expect(once).not.toContain("<table");
    expect(once).not.toContain("<figure");
    expect(once).toContain("legenda");
    expect(census(once).images).toBe(1);
    expect(hasUnsupportedMarkup(once)).toBe(false);

    // Every other tag of the allowlist has a node or a mark here: none of them triggers the
    // warning, and none is lost (the corpus above covers each).
    const supported = ALLOWED_TAGS.filter(
      (tag) => !["table", "thead", "tbody", "tr", "th", "td", "figure", "figcaption"].includes(tag),
    );
    const covered = Object.values(CANONICAL).join("");
    for (const tag of supported) {
      expect(covered, tag).toMatch(new RegExp(`<${tag}\\b`));
      expect(hasUnsupportedMarkup(`<${tag}>`), tag).toBe(false);
    }
  });
});

describe("documento vazio", () => {
  const blanks: Record<string, string> = {
    "editor recém-aberto": "<p></p>",
    "vários parágrafos vazios": "<p></p><p></p><p></p>",
    "só espaços": "<p>   </p>",
    "só uma quebra de linha": "<p><br></p>",
    "título vazio": "<h2></h2>",
  };
  for (const [label, html] of Object.entries(blanks)) {
    it(`${label}: não conta como corpo`, () => {
      expect(hasBodyContent(pasted(html))).toBe(false);
    });
  }

  it("o documento em branco vai para o servidor como texto vazio", () => {
    editor.commands.clearContent();
    expect(editor.getHTML()).toBe("<p></p>");
    expect(editorToStored(editor.getHTML())).toBe("");
    expect(storedToEditor("")).toBe("<p></p>");
  });

  it("o parágrafo vazio que o editor põe depois de um bloco final não é gravado", () => {
    editor.commands.setContent(storedToEditor("<p>texto</p>{{mapa}}"));
    // The editor's own trailing paragraph, so there is somewhere to type after the block.
    expect(editor.getHTML().endsWith("<p></p>")).toBe(true);
    expect(savePath()).toBe("<p>texto</p>{{mapa}}");
    // A paragraph the author left empty in the middle is theirs, and stays.
    expect(roundTrip("<p>um</p><p></p><p>dois</p>")).toBe("<p>um</p><p></p><p>dois</p>");
  });

  it("uma corrida longa de parágrafos vazios é aparada em tempo linear", () => {
    const run = "<p></p>".repeat(40_000);
    const started = performance.now();
    expect(editorToStored(`<p>x</p>${run}`)).toBe("<p>x</p>");
    expect(editorToStored(`${run}<p>x</p>`)).toBe(`${run}<p>x</p>`);
    // The regex this replaced would take minutes here; see tests/helpers/timing.ts for the bound.
    expect(performance.now() - started).toBeLessThan(HOSTILE_INPUT_BUDGET_MS);
  });
});

describe("cada botão da barra produz o que o sanitizador guarda", () => {
  const SRC = "/media/posts/a/b.webp";
  const cases: [string, (e: Editor) => boolean, RegExp][] = [
    ["negrito", (e) => e.chain().selectAll().toggleBold().run(), /<strong>texto<\/strong>/],
    ["itálico", (e) => e.chain().selectAll().toggleItalic().run(), /<em>texto<\/em>/],
    ["riscado", (e) => e.chain().selectAll().toggleMark("strike").run(), /<del>texto<\/del>/],
    ["código", (e) => e.chain().selectAll().toggleCode().run(), /<code>texto<\/code>/],
    ["título de seção", (e) => e.chain().toggleHeading({ level: 2 }).run(), /<h2>texto<\/h2>/],
    ["subtítulo", (e) => e.chain().toggleHeading({ level: 3 }).run(), /<h3>texto<\/h3>/],
    ["lista", (e) => e.chain().toggleBulletList().run(), /<ul><li><p>texto<\/p><\/li><\/ul>/],
    ["lista numerada", (e) => e.chain().toggleOrderedList().run(), /<ol><li><p>texto<\/p><\/li><\/ol>/],
    ["citação", (e) => e.chain().toggleBlockquote().run(), /<blockquote><p>texto<\/p><\/blockquote>/],
    ["bloco de código", (e) => e.chain().toggleCodeBlock().run(), /<pre><code>texto<\/code><\/pre>/],
    ["linha divisória", (e) => e.chain().setHorizontalRule().run(), /<hr \/>/],
    ["quebra de linha", (e) => e.chain().setHardBreak().run(), /<br \/>/],
    [
      "link",
      (e) => e.chain().selectAll().setLink({ href: "https://example.com/x" }).run(),
      /<a href="https:\/\/example\.com\/x">texto<\/a>/,
    ],
    [
      "imagem",
      (e) => insertBlock(e, "image", { src: SRC, alt: "descrição" }),
      /<img src="\/media\/posts\/a\/b\.webp" alt="descrição" \/>/,
    ],
    ...KNOWN_SHORTCODES.map(
      (name): [string, (e: Editor) => boolean, RegExp] => [
        `bloco especial ${name}`,
        (e) => insertBlock(e, "shortcode", { name }),
        new RegExp(`\\{\\{${name}\\}\\}`),
      ],
    ),
  ];
  for (const [label, command, expected] of cases) {
    it(label, () => {
      editor.commands.setContent("<p>texto</p>");
      expect(command(editor), "the command ran").toBe(true);
      const stored = savePath();
      expect(stored).toMatch(expected);
      expect(validateShortcodes(stored).ok).toBe(true);
      // And it is still there after a reload.
      expect(roundTrip(stored)).toBe(stored);
    });
  }

  it("o link sai só com href: nada de target, rel ou class para o sanitizador tirar", () => {
    editor.commands.setContent("<p>texto</p>");
    editor.chain().selectAll().setLink({ href: "/pt/blog/outro" }).run();
    expect(editor.getHTML()).toBe('<p><a href="/pt/blog/outro">texto</a></p>');
  });

  it("o bloco especial mostra o nome em português e não vaza a marcação da tela para o banco", () => {
    editor.commands.setContent(storedToEditor("{{cta:pitch}}"));
    expect(editor.getHTML()).toContain(`>${SHORTCODE_LABELS["cta:pitch"]}</span>`);
    expect(savePath()).toBe("{{cta:pitch}}");
  });
});

// What the browser does with a key: text replaces the current selection, whatever it is. A
// block left selected after its insertion is replaced by the first letter typed; that is the
// defect these tests exist for, and driving commands alone never sees it.
describe("depois de inserir um bloco, digitar não o apaga", () => {
  const SRC = "/media/posts/a/b.webp";
  const type = (text: string) => editor.view.dispatch(editor.state.tr.insertText(text));
  const enter = () => editor.commands.keyboardShortcut("Enter");
  // The cursor in the first textblock of the document, at its end.
  const cursorAtEndOfFirstBlock = () => {
    const first = editor.state.doc.firstChild;
    editor.commands.setTextSelection((first?.nodeSize ?? 2) - 1);
  };

  it("a seleção depois da inserção é um cursor de texto, não o bloco", () => {
    editor.commands.setContent("<p></p>");
    insertBlock(editor, "shortcode", { name: "cta:newsletter" });
    expect(editor.state.selection.empty).toBe(true);
    expect(editor.state.selection.$from.parent.type.name).toBe("paragraph");
  });

  it("bloco em linha vazia, depois texto: o bloco fica e o texto vem depois dele", () => {
    editor.commands.setContent("<p></p>");
    insertBlock(editor, "shortcode", { name: "cta:newsletter" });
    type("continuo escrevendo");
    expect(savePath()).toBe("{{cta:newsletter}}<p>continuo escrevendo</p>");
  });

  it("dois blocos seguidos: os dois ficam, na ordem", () => {
    editor.commands.setContent("<p></p>");
    insertBlock(editor, "shortcode", { name: "cta:pitch" });
    insertBlock(editor, "shortcode", { name: "mapa" });
    type("fim");
    expect(savePath()).toBe("{{cta:pitch}}{{mapa}}<p>fim</p>");
  });

  it("Enter depois de inserir não remove o bloco", () => {
    editor.commands.setContent("<p>antes</p>");
    cursorAtEndOfFirstBlock();
    insertBlock(editor, "shortcode", { name: "mapa" });
    enter();
    type("depois");
    const stored = savePath();
    expect(census(stored).shortcodes).toBe(1);
    expect(stored).toBe("<p>antes</p>{{mapa}}<p></p><p>depois</p>");
  });

  it("imagem, depois texto: a imagem fica", () => {
    editor.commands.setContent("<p>antes</p>");
    cursorAtEndOfFirstBlock();
    insertBlock(editor, "image", { src: SRC, alt: "um gráfico", width: 1600, height: 900 });
    type("legenda solta");
    expect(savePath()).toBe(
      '<p>antes</p><img src="/media/posts/a/b.webp" alt="um gráfico" width="1600" height="900" /><p>legenda solta</p>',
    );
  });

  it("no meio do texto, o bloco vai para depois do parágrafo do cursor, sem cortá-lo", () => {
    editor.commands.setContent("<p>primeiro</p><p>segundo</p>");
    editor.commands.setTextSelection(4);
    insertBlock(editor, "shortcode", { name: "mapa" });
    type("X");
    // A paragraph already followed: the cursor went to its start, and no empty one was added.
    expect(savePath()).toBe("<p>primeiro</p>{{mapa}}<p>Xsegundo</p>");
  });

  it("bloco no fim do documento: sempre há onde escrever depois dele", () => {
    editor.commands.setContent("<p>só isto</p>");
    cursorAtEndOfFirstBlock();
    insertBlock(editor, "shortcode", { name: "mapa" });
    expect(editor.state.doc.lastChild?.type.name).toBe("paragraph");
    type("mais");
    expect(savePath()).toBe("<p>só isto</p>{{mapa}}<p>mais</p>");
  });

  it("com um bloco selecionado (clicado), o novo entra depois dele, não no lugar dele", () => {
    editor.commands.setContent(storedToEditor("{{cta:pitch}}<p>texto</p>"));
    editor.commands.setNodeSelection(0);
    insertBlock(editor, "shortcode", { name: "mapa" });
    expect(savePath()).toBe("{{cta:pitch}}{{mapa}}<p>texto</p>");
  });
});

describe("bloco especial só existe no nível de cima", () => {
  const inList = "<ul><li><p>um item</p></li><li><p>outro item</p></li></ul>";
  const inQuote = "<blockquote><p>uma citação</p></blockquote>";
  // Inside the first textblock, wherever it is nested.
  const cursorInFirstText = () => {
    let at = 1;
    editor.state.doc.descendants((node, pos) => {
      if (at === 1 && node.isTextblock) at = pos + 1;
      return at === 1;
    });
    editor.commands.setTextSelection(at);
  };

  for (const [label, body] of [
    ["lista", inList],
    ["citação", inQuote],
  ] as const) {
    it(`inserido com o cursor dentro de uma ${label}: vai para depois dela, e o servidor aceita`, () => {
      editor.commands.setContent(body);
      cursorInFirstText();
      insertBlock(editor, "shortcode", { name: "cta:pitch" });
      const stored = savePath();
      expect(stored).toBe(`${body}{{cta:pitch}}`);
      expect(validateShortcodes(stored)).toEqual({ ok: true, unknown: [], inline: [] });
    });

    it(`imagem inserida com o cursor dentro de uma ${label}: também vai para depois dela`, () => {
      editor.commands.setContent(body);
      cursorInFirstText();
      insertBlock(editor, "image", { src: "/media/posts/a/b.webp", alt: "x" });
      expect(savePath()).toBe(`${body}<img src="/media/posts/a/b.webp" alt="x" />`);
    });
  }

  it("colado ou arrastado para dentro de item de lista ou de citação: o próprio schema o tira de lá", () => {
    const chip = '<span data-shortcode="mapa">Mapa</span>';
    for (const html of [
      `<ul><li><p>um item</p>${chip}</li></ul>`,
      `<ul><li>${chip}</li></ul>`,
      `<blockquote><p>uma citação</p>${chip}</blockquote>`,
      `<blockquote>${chip}<p>depois</p></blockquote>`,
      `<ol><li><p>a</p><ul><li><p>b${chip}c</p></li></ul></li></ol>`,
    ]) {
      const stored = pasted(html);
      expect(census(stored).shortcodes, html).toBe(1);
      expect(validateShortcodes(stored), html).toEqual({ ok: true, unknown: [], inline: [] });
      expect(roundTrip(stored), html).toBe(stored);
    }
  });

  it("o schema não tem lugar para ele fora do topo", () => {
    const { nodes } = editor.schema;
    const shortcode = nodes.shortcode;
    if (!shortcode) throw new Error("no shortcode node");
    expect(nodes.doc?.contentMatch.matchType(shortcode)).toBeTruthy();
    for (const parent of ["listItem", "blockquote", "paragraph", "heading"]) {
      expect(nodes[parent]?.contentMatch.matchType(shortcode), parent).toBeFalsy();
    }
  });
});

// A real paste goes through the view (clipboard parser, handlePaste), which setContent does not.
// Left to the default, a chip pasted with the cursor in a list item split the list around itself
// and left an empty bullet.
describe("colar um bloco especial com o cursor dentro de uma lista", () => {
  const chip = (name: string) => `<span data-shortcode="${name}">rótulo</span>`;
  const LIST = "<ul><li><p>abcd</p></li><li><p>next</p></li></ul>";
  let mounted: Editor;
  beforeAll(() => {
    installEditorDomStubs();
    const element = document.createElement("div");
    document.body.append(element);
    mounted = new Editor({ element, extensions: editorExtensions, content: "<p></p>" });
  });
  afterAll(() => mounted.destroy());

  const paste = (content: string, cursor: number, html: string) => {
    mounted.commands.setContent(content);
    mounted.commands.setTextSelection(cursor);
    mounted.view.pasteHTML(html);
    return sanitizePostHtml(editorToStored(mounted.getHTML()));
  };

  it("no fim de um item: o bloco vai para depois da lista, e não sobra marcador vazio", () => {
    expect(paste(LIST, 7, chip("mapa"))).toBe(`${LIST}{{mapa}}`);
  });

  it("no meio de um item: a lista não é cortada em duas", () => {
    expect(paste(LIST, 5, chip("mapa"))).toBe(`${LIST}{{mapa}}`);
  });

  it("um item que o admin deixou vazio de propósito continua lá", () => {
    const withEmpty = "<ul><li><p>abcd</p></li><li><p></p></li></ul>";
    expect(paste(withEmpty, 11, chip("mapa"))).toBe(`${withEmpty}{{mapa}}`);
  });

  it("dentro de uma citação, e em parágrafo comum: depois do bloco, como pela barra", () => {
    expect(paste("<blockquote><p>abcd</p></blockquote>", 6, chip("mapa"))).toBe(
      "<blockquote><p>abcd</p></blockquote>{{mapa}}",
    );
    expect(paste("<p>abcd</p><p>depois</p>", 3, chip("mapa"))).toBe("<p>abcd</p>{{mapa}}<p>depois</p>");
    expect(paste("<p></p>", 1, chip("mapa"))).toBe("{{mapa}}");
  });

  it("dois blocos colados de uma vez entram os dois, na ordem, e dá para continuar escrevendo", () => {
    const stored = paste(LIST, 7, chip("cta:pitch") + chip("mapa"));
    expect(stored).toBe(`${LIST}{{cta:pitch}}{{mapa}}`);
    mounted.view.dispatch(mounted.state.tr.insertText("segue"));
    expect(sanitizePostHtml(editorToStored(mounted.getHTML()))).toBe(
      `${LIST}{{cta:pitch}}{{mapa}}<p>segue</p>`,
    );
  });

  it("colagem que não é só bloco segue o caminho normal, e o bloco ainda acaba no nível de cima", () => {
    const stored = paste(LIST, 7, `<p>texto colado</p>${chip("mapa")}<p>mais texto</p>`);
    expect(census(stored).shortcodes).toBe(1);
    expect(validateShortcodes(stored)).toEqual({ ok: true, unknown: [], inline: [] });
    expect(stored).toContain("texto colado");
    expect(stored).toContain("mais texto");
  });

  it("texto comum colado não é tocado por esta regra", () => {
    expect(paste("<p>abcd</p>", 5, "<p>, e mais</p>")).toBe("<p>abcd, e mais</p>");
  });
});

describe("conteúdo hostil colado no editor", () => {
  it("script, manipulador de evento, iframe e estilo não chegam ao banco", () => {
    const stored = pasted(
      '<p onclick="alert(1)" style="color:red">oi<script>alert(1)</script></p><script>alert(2)</script><iframe src="https://evil.example"></iframe><style>p{}</style><p><svg onload="alert(3)"></svg>fim</p>',
    );
    expect(stored).toBe("<p>oi</p><p>fim</p>");
  });

  const unsafeLinks = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "//evil.example/x",
    "/\\evil.example",
    "ftp://example.com/arquivo",
    "tel:+5511999999999",
  ];
  for (const href of unsafeLinks) {
    it(`link ${href}: o texto fica, o destino não`, () => {
      const stored = pasted(`<p><a href="${href.replace(/"/g, "&quot;")}">clique</a></p>`);
      expect(stored).toBe("<p>clique</p>");
    });
  }

  it("comando de link com destino inseguro é recusado pelo próprio editor", () => {
    editor.commands.setContent("<p>texto</p>");
    for (const href of unsafeLinks) {
      expect(editor.chain().selectAll().setLink({ href }).run(), href).toBe(false);
    }
    expect(savePath()).toBe("<p>texto</p>");
  });

  it("imagem de fora, em base64 ou com caminho que sobe de pasta não entra no documento", () => {
    const stored = pasted(
      '<p>a</p><img src="https://evil.example/pixel.png" alt="x"><img src="data:image/png;base64,AAAA"><img src="/media/../segredo.webp"><img src="//evil.example/x.webp"><img src="/media/posts/a/b.webp" alt="nossa" onerror="alert(1)"><p>b</p>',
    );
    expect(stored).toBe('<p>a</p><img src="/media/posts/a/b.webp" alt="nossa" /><p>b</p>');
  });

  it("bloco especial colado dentro de um parágrafo é levado para fora dele", () => {
    const stored = pasted('<p>antes <span data-shortcode="cta:pitch">CTA</span> depois</p>');
    expect(census(stored).shortcodes).toBe(1);
    expect(validateShortcodes(stored)).toEqual({ ok: true, unknown: [], inline: [] });
    expect(stored).toContain("antes");
    expect(stored).toContain("depois");
  });

  it("{{nome}} digitado como texto dentro de um parágrafo chega como está, e é o servidor que recusa", () => {
    const stored = pasted("<p>veja {{cta:pitch}} aqui</p>");
    expect(stored).toBe("<p>veja {{cta:pitch}} aqui</p>");
    // posts.ts turns this into "Shortcode precisa ficar sozinho, fora de parágrafo".
    expect(validateShortcodes(stored)).toEqual({ ok: false, unknown: [], inline: ["cta:pitch"] });
  });

  it("bloco especial de nome desconhecido não vira bloco calado: o servidor recusa pelo nome", () => {
    const stored = pasted('<p>a</p><span data-shortcode="calculadora:furo">x</span>');
    expect(validateShortcodes(stored)).toEqual({ ok: false, unknown: ["calculadora:furo"], inline: [] });
  });

  it("nome de bloco fora da gramática não é bloco, e nada dele vira marcação", () => {
    const stored = pasted(
      '<p>a</p><span data-shortcode="x}}<script>alert(1)</script>{{y">rótulo</span><span data-shortcode="A B">outro</span>',
    );
    expect(stored).not.toContain("{{");
    expect(stored).not.toContain("<script");
    expect(stored).not.toContain("<span");
  });

  it("h1 colado não vira título de página; sublinhado e cor somem, o texto fica", () => {
    const stored = pasted('<h1>Título</h1><p><u>sublinhado</u> <font color="red">vermelho</font> <s>riscado</s></p>');
    // The <s> of another editor is kept, as the <del> the allowlist has.
    expect(stored).toBe("<p>Título</p><p>sublinhado vermelho <del>riscado</del></p>");
  });

  it("depois de qualquer colagem hostil, a segunda passada é estável", () => {
    const hostile = [
      '<p>t <span data-shortcode="mapa">m</span> t</p><p><a href="javascript:x">j</a></p>',
      "<div><div><p>fundo</p></div><ul><li>solto</li></ul></div><table><tr><td>célula</td></tr></table>",
      "<p>   espaço   no   meio   </p><p>&nbsp;</p>",
    ];
    for (const html of hostile) {
      const once = roundTrip(pasted(html));
      expect(roundTrip(once), html).toBe(once);
    }
  });
});
