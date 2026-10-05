// The target is not the public page (an anonymous reader has no session to steal): it is the
// review screen, which renders the body inside the admin's session. These tests are pure on
// purpose, so they run on every machine without a database.
import { MAX_BODY_HTML_LENGTH } from "./body-content";
import { ALLOWED_TAGS, BodyTooLargeError, isSafeHref, sanitizePostHtml } from "./sanitize";

describe("a allowlist", () => {
  it("não contém nenhuma tag que executa, enquadra ou envia", () => {
    // The other tests check the output against this export, so the export itself is pinned here.
    for (const tag of [
      "script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea",
      "select", "svg", "math", "base", "meta", "link", "h1", "span", "div", "video", "audio",
    ]) {
      expect(ALLOWED_TAGS, tag).not.toContain(tag);
    }
    expect(ALLOWED_TAGS).toHaveLength(25);
  });
});

describe("href só aponta para onde dá para ver", () => {
  const link = (href: string) => sanitizePostHtml(`<a href="${href}">x</a>`);

  it("mantém https, http, mailto, âncora e caminho a partir da raiz", () => {
    for (const href of [
      "https://x.com/a?b=c#d",
      "HTTPS://X.COM",
      "http://x.com",
      "mailto:oi@x.com",
      "#secao",
      "/",
      "/pt/pitch",
      "/a/b?c=d#e",
    ]) {
      expect(isSafeHref(href), href).toBe(true);
      expect(link(href), href).toContain("href=");
    }
  });

  it("remove o href com barra invertida: o navegador lê /\\host como //host", () => {
    for (const href of [
      "/\\evil.com",
      "\\\\evil.com",
      "/\\/evil.com",
      "\\/evil.com",
      "https:\\\\evil.com",
      "https:/\\evil.com",
      "https://x.com\\@evil.com",
      "/a\\b",
    ]) {
      expect(isSafeHref(href), href).toBe(false);
      expect(link(href), href).toBe("<a>x</a>");
    }
  });

  it("remove o href com caractere de controle: o navegador o apaga antes de resolver", () => {
    for (const href of ["/\t/evil.com", "/\n/evil.com", "/\r/evil.com", "/x\t", "https://x.com/\n"]) {
      expect(isSafeHref(href), JSON.stringify(href)).toBe(false);
      expect(link(href), JSON.stringify(href)).toBe("<a>x</a>");
    }
    expect(isSafeHref(`/x${String.fromCharCode(0)}`)).toBe(false);
    expect(isSafeHref(`/x${String.fromCharCode(127)}`)).toBe(false);
  });

  it("remove o que chega escrito como entidade", () => {
    for (const href of ["/&#92;evil.com", "/&#x5C;evil.com", "/&#9;/evil.com", "&#x2F;&#x2F;evil.com"]) {
      expect(link(href), href).toBe("<a>x</a>");
    }
  });

  it("remove relativo a protocolo, relativo ao documento e esquema fora da lista", () => {
    for (const href of [
      "//evil.com",
      "///evil.com",
      "https:evil.com",
      "https:/evil.com",
      "relativo/caminho",
      "../x",
      "?q=1",
      " /x",
      "ftp://x.com",
      "tel:+5511999999999",
      "javascript:alert(1)",
      "data:text/html,x",
      "",
    ]) {
      expect(isSafeHref(href), JSON.stringify(href)).toBe(false);
      expect(link(href), JSON.stringify(href)).toBe("<a>x</a>");
    }
  });

  it("o título do link fica mesmo quando o href sai", () => {
    expect(sanitizePostHtml('<a href="/\\evil.com" title="t">x</a>')).toBe('<a title="t">x</a>');
  });
});

describe("o teto do corpo", () => {
  it("aceita exatamente no teto", () => {
    const body = "a".repeat(MAX_BODY_HTML_LENGTH);
    expect(sanitizePostHtml(body)).toBe(body);
  });

  it("acima do teto estoura um erro com nome, em vez de processar", () => {
    const body = "a".repeat(MAX_BODY_HTML_LENGTH + 1);
    expect(() => sanitizePostHtml(body)).toThrow(BodyTooLargeError);
    try {
      sanitizePostHtml(body);
    } catch (error) {
      expect(error).toBeInstanceOf(BodyTooLargeError);
      expect((error as BodyTooLargeError).length).toBe(MAX_BODY_HTML_LENGTH + 1);
      expect((error as BodyTooLargeError).name).toBe("BodyTooLargeError");
    }
  });

  it("o resultado também respeita o teto: escapar faz o texto crescer", () => {
    // 100 thousand "&" fit the cap going in and come out as 500 thousand characters of "&amp;".
    expect(() => sanitizePostHtml("&".repeat(100_000))).toThrow(BodyTooLargeError);
    expect(sanitizePostHtml("&".repeat(60_000))).toHaveLength(300_000);
  });

  it("o que foi aceito uma vez é aceito de novo ao servir", () => {
    const stored = sanitizePostHtml("&".repeat(60_000));
    expect(sanitizePostHtml(stored)).toBe(stored);
  });

  it("entrada hostil no teto termina em tempo limitado", () => {
    // sanitize-html is a real parser: about half a second here, where the regexes of this folder
    // take milliseconds. The bound only guards against something superlinear creeping in.
    for (const unit of ["<h2>x", "<p>x", "<strong>", "<", '<a href="/x">', '<img src="/media/a.webp">']) {
      const input = unit.repeat(Math.floor(MAX_BODY_HTML_LENGTH / unit.length));
      const start = performance.now();
      try {
        sanitizePostHtml(input);
      } catch (error) {
        expect(error, unit).toBeInstanceOf(BodyTooLargeError);
      }
      expect(performance.now() - start, unit).toBeLessThan(5000);
    }
  });
});

describe("o que o post pode conter", () => {
  it("mantém as tags da allowlist intactas", () => {
    const html =
      "<h2>Titulo</h2><p>Texto <strong>forte</strong> e <em>leve</em></p><ul><li>Item</li></ul>";
    expect(sanitizePostHtml(html)).toBe(html);
  });

  it("mantém imagem de /media com alt e dimensões", () => {
    const out = sanitizePostHtml(
      '<img src="/media/posts/novo/foto.webp" alt="Foto" width="800" height="600">',
    );
    expect(out).toContain('src="/media/posts/novo/foto.webp"');
    expect(out).toContain('alt="Foto"');
    expect(out).toContain('width="800"');
    expect(out).toContain('height="600"');
  });

  it("mantém figure com legenda, e tabela com alinhamento", () => {
    const figure = sanitizePostHtml(
      '<figure><img src="/media/f.webp" alt="F"><figcaption>Legenda</figcaption></figure>',
    );
    expect(figure).toContain('<img src="/media/f.webp" alt="F"');
    expect(figure).toContain("<figcaption>Legenda</figcaption>");
    expect(sanitizePostHtml('<table><tr><td align="right">1</td></tr></table>')).toContain(
      'align="right"',
    );
  });

  it("não acrescenta target nem rel: link interno não pode abrir aba nova", () => {
    const out = sanitizePostHtml('<a href="/pt/pitch">o pitch</a>');
    expect(out).toBe('<a href="/pt/pitch">o pitch</a>');
    expect(out).not.toContain("target");
  });

  it("mantém http, https e mailto", () => {
    for (const href of ["https://ash.app.br", "http://x.com", "mailto:oi@x.com"]) {
      expect(sanitizePostHtml(`<a href="${href}">l</a>`)).toContain(`href="${href}"`);
    }
  });

  it("mantém shortcode em nível de bloco", () => {
    const html = "<p>Antes</p>{{cta:pitch}}<p>Depois</p>";
    expect(sanitizePostHtml(html)).toBe(html);
  });
});

describe("img src só aceita /media/", () => {
  // An image hosted elsewhere is a request to a third party on every page view, which the site
  // promises not to make. The whole tag goes: an <img> without src is only a broken icon.
  const dropped = (src: string) => sanitizePostHtml(`<p>Oi</p><img src="${src}" alt="A">`);

  it("remove imagem com endereço absoluto, mesmo do próprio domínio", () => {
    for (const src of [
      "https://evil.example/pixel.gif",
      "http://evil.example/a.png",
      "https://ash.app.br/media/a.webp",
      "https://pub.ash.app.br/media/a.webp",
    ]) {
      expect(dropped(src), src).toBe("<p>Oi</p>");
    }
  });

  it("remove imagem relativa a protocolo", () => {
    expect(dropped("//evil.example/media/a.webp")).toBe("<p>Oi</p>");
  });

  it("remove imagem data:", () => {
    expect(dropped("data:image/png;base64,iVBORw0KGgo=")).toBe("<p>Oi</p>");
    expect(dropped("data:image/svg+xml,<svg onload=alert(1)>")).not.toContain("<img");
  });

  it("remove imagem com travessia de diretório", () => {
    for (const src of [
      "/media/../x",
      "/media/posts/../../api/admin/x",
      "/media/%2e%2e/x",
      "/media/..%2Fx",
      "/media/a\\..\\x",
      "/media//evil.example/a.webp",
    ]) {
      expect(dropped(src), src).toBe("<p>Oi</p>");
    }
  });

  it("remove imagem fora de /media ou sem src", () => {
    for (const src of ["/blog/foto.png", "foto.png", "media/a.webp", "/media", "/media/", "x", ""]) {
      expect(dropped(src), src).toBe("<p>Oi</p>");
    }
    expect(sanitizePostHtml('<p>Oi</p><img alt="A">')).toBe("<p>Oi</p>");
  });

  it("remove imagem com query string (o /media não tem parâmetros)", () => {
    expect(dropped("/media/a.webp?x=https://evil.example")).toBe("<p>Oi</p>");
  });

  it("srcset não passa: seria um segundo endereço sem a mesma regra", () => {
    const out = sanitizePostHtml(
      '<img src="/media/a.webp" srcset="https://evil.example/a.png 2x" alt="A">',
    );
    expect(out).toContain('src="/media/a.webp"');
    expect(out).not.toContain("srcset");
    expect(out).not.toContain("evil.example");
  });

  it("a imagem recusada some, a legenda fica", () => {
    expect(
      sanitizePostHtml(
        '<figure><img src="https://evil.example/a.png"><figcaption>L</figcaption></figure>',
      ),
    ).toBe("<figure><figcaption>L</figcaption></figure>");
  });
});

describe("o que nunca pode chegar à sessão do admin", () => {
  it("remove <script> inteiro, com o conteúdo", () => {
    const out = sanitizePostHtml('<p>Oi</p><script>fetch("/api/admin/x")</script>');
    expect(out).toBe("<p>Oi</p>");
    expect(out).not.toContain("fetch");
  });

  it("remove <script> escrito para enganar quem lê uma denylist", () => {
    // The assertion is not "the word alert is gone": in the nested case the sanitizer drops the
    // tag and escapes the rest as text, and a post may legitimately talk about alert(1). The
    // security property is that no executable tag survives.
    for (const poison of [
      "<ScRiPt>alert(1)</ScRiPt>",
      "<scr<script>ipt>alert(1)</script>",
      "<script\n>alert(1)</script>",
      "<img src=x onerror=alert(1)>",
      "<img src=/media/a.webp onerror=alert(1)>",
    ]) {
      const out = sanitizePostHtml(poison).toLowerCase();
      expect(out, poison).not.toContain("<script");
      expect(out, poison).not.toContain("onerror");
      // Any "<" left may only open an allowlisted tag; the rest came out escaped as "&lt;".
      for (const tag of out.match(/<\s*\/?\s*([a-z0-9]+)/g) ?? []) {
        const name = tag.replace(/[<\s/]/g, "");
        expect(ALLOWED_TAGS, `${poison} deixou a tag <${name}> viva`).toContain(name);
      }
    }
  });

  it("remove onerror da imagem (dispara sem ninguém clicar)", () => {
    const out = sanitizePostHtml('<img src="/media/a.webp" onerror="alert(document.cookie)">');
    expect(out).toContain('src="/media/a.webp"');
    expect(out).not.toContain("onerror");
    expect(out).not.toContain("alert");
  });

  it("remove todo atributo de evento", () => {
    for (const attr of ["onclick", "onload", "onmouseover", "onfocus", "onanimationstart"]) {
      expect(sanitizePostHtml(`<p ${attr}="alert(1)">Oi</p>`), attr).toBe("<p>Oi</p>");
    }
  });

  it("remove iframe, object, embed, form, input e svg", () => {
    for (const tag of [
      '<iframe src="https://evil.com"></iframe>',
      '<object data="x.swf"></object>',
      '<embed src="x.swf">',
      '<form action="/api"><input name="x"></form>',
      '<svg onload="alert(1)"></svg>',
    ]) {
      expect(sanitizePostHtml(`<p>Oi</p>${tag}`), tag).toBe("<p>Oi</p>");
    }
  });

  it("remove base e meta (os dois sequestram a página inteira)", () => {
    expect(sanitizePostHtml('<base href="https://evil.com"><p>Oi</p>')).toBe("<p>Oi</p>");
    expect(
      sanitizePostHtml('<meta http-equiv="refresh" content="0;url=https://evil.com"><p>Oi</p>'),
    ).toBe("<p>Oi</p>");
  });

  it("remove style inline e class", () => {
    // position:fixed;inset:0 covers the whole screen with a link: clickjacking without an iframe.
    expect(sanitizePostHtml('<p style="position:fixed;inset:0">Oi</p>')).toBe("<p>Oi</p>");
    expect(sanitizePostHtml('<p class="fixed inset-0">Oi</p>')).toBe("<p>Oi</p>");
    expect(sanitizePostHtml("<style>p{display:none}</style><p>Oi</p>")).toBe("<p>Oi</p>");
  });

  it("descarta javascript: no href, inclusive disfarçado", () => {
    for (const href of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", " javascript:alert(1)"]) {
      const out = sanitizePostHtml(`<a href="${href}">x</a>`);
      expect(out, href).not.toContain("javascript");
      expect(out, href).not.toContain("alert");
    }
  });

  it("descarta data: no href (data:text/html executa no clique)", () => {
    expect(sanitizePostHtml('<a href="data:text/html,<b>x</b>">x</a>')).not.toContain("data:");
  });

  it("descarta o endereço relativo a protocolo (//evil.com)", () => {
    // It looks like a relative path and is not: it inherits the page's protocol.
    expect(sanitizePostHtml('<a href="//evil.com/x">clique</a>')).not.toContain("evil.com");
  });

  it("h1 não entra: o h1 da página é o título do post", () => {
    const out = sanitizePostHtml("<h1>Sequestrando o titulo</h1>");
    expect(out).toContain("Sequestrando o titulo");
    expect(out).not.toContain("<h1>");
  });

  it("id só passa em cabeçalho", () => {
    // Limited to h2/h3/h4 because the table of contents overwrites it there; a free id on any
    // tag opens the door to DOM clobbering.
    for (const html of [
      '<p id="x">a</p>',
      '<a id="y" href="/b">l</a>',
      '<img id="z" src="/media/a.webp">',
    ]) {
      expect(sanitizePostHtml(html), html).not.toContain("id=");
    }
    expect(sanitizePostHtml('<h2 id="secao">T</h2>')).toBe('<h2 id="secao">T</h2>');
  });
});

describe("a propriedade que as duas pontas exigem", () => {
  it("sanitizar duas vezes dá o mesmo que sanitizar uma", () => {
    // The body goes through this on save and again on serve. If the second pass changed the
    // result, what the author saw in the preview would not be what the reader gets.
    const cases = [
      '<h2>T</h2><p>a <strong>b</strong> <a href="https://x.com">c</a></p>',
      '<p onclick="x()">Oi</p><script>y()</script>',
      '<figure><img src="/media/a.webp" alt="A"><figcaption>L</figcaption></figure>',
      '<figure><img src="https://evil.example/a.png" alt="A"><figcaption>L</figcaption></figure>',
      '<a href="javascript:alert(1)">x</a>',
      "<p>a &amp; b &lt; c</p>",
      "<p>a</p>{{mapa}}<p>b</p>",
      "<scr<script>ipt>alert(1)</script>",
    ];
    for (const html of cases) {
      const once = sanitizePostHtml(html);
      expect(sanitizePostHtml(once), html).toBe(once);
    }
  });

  it("corpo vazio e corpo só de espaços não quebram", () => {
    expect(sanitizePostHtml("")).toBe("");
    expect(sanitizePostHtml("   ").trim()).toBe("");
  });
});

describe("o editor e o sanitizador concordam", () => {
  // The failure this block exists to catch is silent: if an editor extension emits a tag the
  // allowlist lacks, the author formats, sees it, saves, and the formatting is gone with no
  // error. The two lists live in different files, so only one sample per tag proves they agree.
  const FROM_EDITOR: [string, string][] = [
    ["parágrafo", "<p>texto</p>"],
    ["negrito", "<p><strong>forte</strong></p>"],
    ["itálico", "<p><em>leve</em></p>"],
    ["h2", "<h2>Seção</h2>"],
    ["h3", "<h3>Subtítulo</h3>"],
    ["h4", "<h4>Menor</h4>"],
    ["lista", "<ul><li>item</li></ul>"],
    ["lista numerada", "<ol><li>item</li></ol>"],
    ["citação", "<blockquote><p>dito</p></blockquote>"],
    ["código", "<p><code>const x = 1</code></p>"],
    ["bloco de código", "<pre><code>linha</code></pre>"],
    ["linha", "<hr>"],
    ["quebra", "<p>a<br>b</p>"],
    ["link", '<p><a href="https://x.com">l</a></p>'],
    ["imagem", '<img src="/media/posts/novo/a.webp" alt="A">'],
  ];

  for (const [name, html] of FROM_EDITOR) {
    it(`${name} sobrevive à gravação`, () => {
      // Comparing the whole string would be brittle (<hr> and <br> get normalized); the opening
      // tag disappearing is exactly the defect.
      const tag = /<([a-z0-9]+)/.exec(html)?.[1] ?? "";
      expect(sanitizePostHtml(html), `a allowlist descarta <${tag}>`).toContain(`<${tag}`);
    });
  }

  it("as extensões que produzem tag proibida continuam de fora", () => {
    // strike emits <s> and underline emits <u>; the editor must keep both off.
    for (const forbidden of ["<s>riscado</s>", "<u>sublinhado</u>"]) {
      const out = sanitizePostHtml(`<p>${forbidden}</p>`);
      expect(out, forbidden).not.toMatch(/<[su]>/);
      expect(out).toMatch(/riscado|sublinhado/);
    }
  });

  it("os atributos que o link do editor carrega saem, o href fica", () => {
    expect(
      sanitizePostHtml(
        '<a target="_blank" rel="noopener noreferrer nofollow" class="link" href="https://x.com">l</a>',
      ),
    ).toBe('<a href="https://x.com">l</a>');
  });
});
