import { describe, expect, it } from "vitest";
import { deriveIntentId, deriveIntentIdHex, intentIdFromHex, intentIdToHex } from "./intent-id.js";

const SESSION = "11111111111111111111111111111114";
const DESTINATION = "11111111111111111111111111111115";
const MINT = "So11111111111111111111111111111111111111112";

const key = {
  session: SESSION,
  destination: DESTINATION,
  mint: MINT,
  amount: 1_000_000n,
  reference: "INV-2026-0041",
};

describe("deriveIntentId", () => {
  it("is stable across attempts at the same payment", () => {
    // The whole point: a retry lands on the same receipt PDA and the program refuses it.
    expect(deriveIntentIdHex(key)).toBe(deriveIntentIdHex({ ...key }));
  });

  it("changes when any payment parameter changes", () => {
    const base = deriveIntentIdHex(key);
    expect(deriveIntentIdHex({ ...key, amount: 1_000_001n })).not.toBe(base);
    expect(deriveIntentIdHex({ ...key, destination: SESSION })).not.toBe(base);
    expect(deriveIntentIdHex({ ...key, reference: "INV-2026-0042" })).not.toBe(base);
    expect(deriveIntentIdHex({ ...key, session: DESTINATION })).not.toBe(base);
  });

  it("cannot be steered across a field boundary", () => {
    // Without length prefixes, ("ab", "c") and ("a", "bc") would hash identically, which is
    // a way to aim one payment's key at another payment's receipt.
    expect(deriveIntentIdHex({ ...key, reference: "a", destination: `${DESTINATION}b` })).not.toBe(
      deriveIntentIdHex({ ...key, reference: "ba", destination: DESTINATION }),
    );
  });

  it("produces a 16-byte seed", () => {
    expect(deriveIntentId(key)).toHaveLength(16);
    expect(deriveIntentIdHex(key)).toHaveLength(32);
  });

  it("round-trips through hex", () => {
    const id = deriveIntentId(key);
    expect(intentIdFromHex(intentIdToHex(id))).toEqual(id);
  });

  it("rejects malformed hex", () => {
    expect(() => intentIdFromHex("nope")).toThrow(RangeError);
    expect(() => intentIdFromHex("AB".repeat(16))).toThrow(RangeError);
  });
});
