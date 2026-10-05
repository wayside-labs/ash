import { HOSTILE_INPUT_BUDGET_MS } from "../../../tests/helpers/timing";
import { decodeEntities } from "./entities";

const NBSP = String.fromCharCode(160);

describe("decodeEntities", () => {
  it("decodifica as entidades nomeadas que o sanitizador emite", () => {
    expect(decodeEntities("Tom &amp; Jerry")).toBe("Tom & Jerry");
    expect(decodeEntities("1 &lt; 2 &gt; 0")).toBe("1 < 2 > 0");
    expect(decodeEntities("&quot;aspas&quot; e &#39;apóstrofo&#39; e &apos;outro&apos;")).toBe(
      "\"aspas\" e 'apóstrofo' e 'outro'",
    );
    expect(decodeEntities("a&nbsp;b")).toBe(`a${NBSP}b`);
  });

  it("decodifica as numéricas, decimais e hexadecimais", () => {
    expect(decodeEntities("caf&#233;")).toBe("café");
    expect(decodeEntities("caf&#xE9; caf&#xe9; caf&#XE9;")).toBe("café café café");
    expect(decodeEntities("&#128512;")).toBe(String.fromCodePoint(128512));
    expect(decodeEntities("&#160;")).toBe(NBSP);
  });

  it("decodifica uma vez só: o que estava escapado em dobro continua escapado", () => {
    expect(decodeEntities("&amp;lt;b&amp;gt;")).toBe("&lt;b&gt;");
    expect(decodeEntities("&amp;amp;")).toBe("&amp;");
  });

  it("deixa como está o que não é entidade conhecida ou não é um caractere válido", () => {
    for (const text of [
      "a & b",
      "&copy;",
      "&amp",
      "&;",
      "&#;",
      "&#x;",
      "&#0;",
      "&#1114112;",
      "&#xD800;",
      "&#55296;",
      "&#99999999999;",
    ]) {
      expect(decodeEntities(text), text).toBe(text);
    }
  });

  it("texto sem entidade sai igual", () => {
    expect(decodeEntities("")).toBe("");
    expect(decodeEntities("só texto")).toBe("só texto");
  });

  it("entrada hostil no teto do corpo termina rápido", () => {
    for (const unit of ["&", "&#", "&#x", "&amp", "&#1"]) {
      const input = unit.repeat(Math.floor(300_000 / unit.length));
      const start = performance.now();
      decodeEntities(input);
      expect(performance.now() - start, unit).toBeLessThan(HOSTILE_INPUT_BUDGET_MS);
    }
  });
});
