import { describe, expect, it } from "vitest";
import { countryFromBrowser, currencyFor, formatBalance, normalizeCountry } from "./region";

describe("normalizeCountry", () => {
  it("accepts a two-letter code in any case", () => {
    expect(normalizeCountry("br")).toBe("BR");
    expect(normalizeCountry(" US ")).toBe("US");
  });

  it("treats Cloudflare's unknown and Tor placeholders as no country", () => {
    for (const raw of ["XX", "T1", "", null, undefined, "BRA", "1A"]) {
      expect(normalizeCountry(raw)).toBeNull();
    }
  });
});

describe("region choices", () => {
  it("shows reais in Brazil only", () => {
    expect(currencyFor("BR")).toBe("BRL");
    for (const country of ["US", "PT", null]) expect(currencyFor(country)).toBe("USD");
  });

  it("guesses Brazil from a Brazilian time zone or a pt-BR language", () => {
    expect(countryFromBrowser("America/Sao_Paulo", ["en-US"])).toBe("BR");
    expect(countryFromBrowser("Europe/Lisbon", ["pt-BR", "en"])).toBe("BR");
    expect(countryFromBrowser("Europe/Lisbon", ["pt-PT"])).toBeNull();
    expect(countryFromBrowser(undefined, [])).toBeNull();
  });
});

describe("formatBalance", () => {
  it("converts micro-USD at the rate for a BRL viewer", () => {
    const text = formatBalance(
      2_000_000,
      { country: "BR", currency: "BRL", usdRate: 5.5 },
      "pt-BR",
    );
    expect(text.replace(/\s/g, " ")).toBe("R$ 11,00");
  });

  it("falls back to USD when there is no rate, rather than showing dollars as reais", () => {
    expect(formatBalance(2_000_000, { country: "BR", currency: "BRL", usdRate: null }, "en")).toBe(
      "$2.00",
    );
  });
});
