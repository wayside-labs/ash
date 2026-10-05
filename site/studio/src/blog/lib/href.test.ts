// The same lists sanitize.test.ts runs through the sanitizer, here against the function alone:
// the link dialog calls it in the browser, where there is no sanitizer.
import { isSafeHref } from "./href";
import { isSafeHref as fromSanitize } from "./sanitize";

describe("isSafeHref", () => {
  it("aceita https, http, mailto, âncora e caminho a partir da raiz", () => {
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
    }
  });

  it("recusa barra invertida em qualquer lugar: o navegador lê /\\host como //host", () => {
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
    }
  });

  it("recusa caractere de controle: o navegador o apaga antes de resolver", () => {
    for (const code of [0, 9, 10, 13, 31, 127]) {
      const ch = String.fromCharCode(code);
      expect(isSafeHref(`/${ch}/evil.com`), `code ${code}`).toBe(false);
      expect(isSafeHref(`https://x.com/${ch}`), `code ${code}`).toBe(false);
    }
  });

  it("recusa relativo a protocolo, relativo ao documento e esquema fora da lista", () => {
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
    }
  });

  it("o sanitizador usa esta mesma função, não uma cópia", () => {
    expect(fromSanitize).toBe(isSafeHref);
  });
});
