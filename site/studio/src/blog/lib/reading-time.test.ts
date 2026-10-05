import { HOSTILE_INPUT_BUDGET_MS } from "../../../tests/helpers/timing";
import { readingTimeMinutes } from "./reading-time";

describe("readingTimeMinutes", () => {
  it("mínimo de 1 minuto para textos curtos", () => {
    expect(readingTimeMinutes("<p>Oi</p>")).toBe(1);
    expect(readingTimeMinutes("")).toBe(1);
  });

  it("ignora tags HTML na contagem de palavras", () => {
    const html = `<h2>${"palavra ".repeat(100)}</h2><p>${"palavra ".repeat(100)}</p>`;
    expect(readingTimeMinutes(html)).toBe(1);
  });

  it("arredonda pra cima em ~200 palavras/min", () => {
    const html = `<p>${"palavra ".repeat(450)}</p>`;
    expect(readingTimeMinutes(html)).toBe(3);
  });

  it("não conta shortcodes como texto", () => {
    const html = `<p>${"palavra ".repeat(10)}</p>{{cta:pitch}}`;
    expect(readingTimeMinutes(html)).toBe(1);
    expect(readingTimeMinutes(`<p>${"palavra ".repeat(200)}</p>{{mapa}}`)).toBe(1);
  });

  it("chaves que não formam um shortcode são texto como qualquer outro", () => {
    expect(readingTimeMinutes(`{{ ${"palavra ".repeat(250)} }}`)).toBe(2);
  });

  it("entrada hostil no teto do corpo termina rápido", () => {
    for (const unit of ["{{", "<", "{{a", "<a", "{{a:", " ", "<p>x</p>"]) {
      const input = unit.repeat(Math.floor(300_000 / unit.length));
      const start = performance.now();
      readingTimeMinutes(input);
      expect(performance.now() - start, unit).toBeLessThan(HOSTILE_INPUT_BUDGET_MS);
    }
  });
});
