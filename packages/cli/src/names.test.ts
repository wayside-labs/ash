import { describe, expect, it } from "vitest";
import { CliError } from "./errors.js";
import { decodeFixedName, encodeFixedName } from "./names.js";

describe("encodeFixedName", () => {
  it("pads to the program's 32-byte field", () => {
    const encoded = encodeFixedName("default", "--name");
    expect(encoded).toHaveLength(32);
    expect(Array.from(encoded.subarray(7))).toEqual(new Array(25).fill(0));
  });

  it("round-trips through decode", () => {
    expect(decodeFixedName(encodeFixedName("treasury-ops", "--name"))).toBe("treasury-ops");
  });

  it("rejects an empty name, which the program refuses as InvalidName", () => {
    expect(() => encodeFixedName("   ", "--name")).toThrow(CliError);
  });

  it("rejects an embedded NUL rather than silently truncating at it", () => {
    expect(() => encodeFixedName("a\0b", "--name")).toThrow(CliError);
  });

  /**
   * The case that motivates measuring in bytes: eleven emoji are eleven characters and
   * forty-four bytes. Truncating to 32 bytes would split the last one and produce invalid
   * UTF-8, which the program rejects as `InvalidName` — a failure that looks like a bug in
   * the program and only reproduces for non-ASCII names.
   */
  it("rejects a name that is short in characters but too long in bytes", () => {
    expect(() => encodeFixedName("💸".repeat(11), "--name")).toThrow(/44 bytes/);
  });

  it("accepts multi-byte names that do fit", () => {
    const encoded = encodeFixedName("tesorería", "--name");
    expect(decodeFixedName(encoded)).toBe("tesorería");
  });
});
