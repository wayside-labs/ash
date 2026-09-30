import { describe, expect, it } from "vitest";
import { parseAwesomeApi, parseFrankfurter } from "./fx";

describe("fx parsers", () => {
  it("reads AwesomeAPI's bid", () => {
    expect(parseAwesomeApi({ USDBRL: { bid: "5.4321" } })).toBe(5.4321);
  });

  it("reads Frankfurter's rate", () => {
    expect(parseFrankfurter({ rates: { BRL: 5.1 } })).toBe(5.1);
  });

  it("refuses a missing, zero or non-numeric rate", () => {
    for (const body of [null, {}, { USDBRL: { bid: "0" } }, { USDBRL: { bid: "abc" } }]) {
      expect(parseAwesomeApi(body)).toBeNull();
    }
    expect(parseFrankfurter({ rates: {} })).toBeNull();
  });
});
