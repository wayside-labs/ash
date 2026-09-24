import { describe, expect, it } from "vitest";
import {
  addressFromMnemonic,
  createMnemonic,
  isValidMnemonic,
  SOLANA_ACCOUNT_0_PATH,
} from "./mnemonic";

/**
 * Vectors produced by `solana-keygen recover` (Agave 3.1.14) from the BIP-39
 * canonical phrase, not by this code. They are the point of the file: a
 * derivation that only agrees with itself would hand the user a phrase that
 * imports into their wallet as a different, empty address.
 */
const CANONICAL = `${"abandon ".repeat(11)}about`;
const AGAVE = {
  "m/44'/501'/0'": "GjJyeC1r2RgkuoCWMyPYkCWSGSGLcz266EaAkLA27AhL",
  "m/44'/501'/0'/0'": "HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk",
  "m/44'/501'/1'/0'": "Hh8QwFUA6MtVu1qAoq12ucvFHNwCcVTV7hpWjeY1Hztb",
} as const;

describe("addressFromMnemonic", () => {
  for (const [path, expected] of Object.entries(AGAVE)) {
    it(`matches solana-keygen at ${path}`, async () => {
      expect(await addressFromMnemonic(CANONICAL, path)).toBe(expected);
    });
  }

  it("defaults to the path wallets import as account 0", async () => {
    expect(SOLANA_ACCOUNT_0_PATH).toBe("m/44'/501'/0'/0'");
    expect(await addressFromMnemonic(CANONICAL)).toBe(AGAVE["m/44'/501'/0'/0'"]);
  });

  it("is unmoved by the whitespace and case a paste carries", async () => {
    const messy = `  ${CANONICAL.toUpperCase().replace(/ /g, "\n  ")}  `;
    expect(await addressFromMnemonic(messy)).toBe(AGAVE["m/44'/501'/0'/0'"]);
  });
});

describe("createMnemonic", () => {
  it("produces twelve words that validate", () => {
    const phrase = createMnemonic();
    expect(phrase.split(" ")).toHaveLength(12);
    expect(isValidMnemonic(phrase)).toBe(true);
  });

  it("does not repeat itself", () => {
    expect(createMnemonic()).not.toBe(createMnemonic());
  });
});

describe("isValidMnemonic", () => {
  it("rejects a phrase whose checksum does not hold", () => {
    // Same word list, wrong last word: exactly what a typo produces.
    expect(isValidMnemonic(`${"abandon ".repeat(11)}abandon`)).toBe(false);
  });

  it("rejects a word outside the list", () => {
    expect(isValidMnemonic(`${"abandon ".repeat(11)}zzzz`)).toBe(false);
  });
});
