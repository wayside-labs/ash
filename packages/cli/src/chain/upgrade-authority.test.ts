import { address, getAddressEncoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import { decodeUpgradeAuthority } from "./upgrade-authority.js";

/**
 * The offsets are the whole risk here. ADR-011 makes the upgrade authority the trust claim a
 * user is told to check, and a header read one byte off turns "renounced" into a key — or a
 * key into "renounced". Both read plausibly in a terminal, which is why they are pinned.
 */
const AUTHORITY = address("5eznzq18xdeVaagEkyo7DYb8v12mAWmYcz6AdWTnH8JQ");

function header(options: { tag?: number; hasAuthority: boolean }): Uint8Array {
  const bytes = new Uint8Array(45);
  new DataView(bytes.buffer).setUint32(0, options.tag ?? 3, true);
  new DataView(bytes.buffer).setBigUint64(4, 501_509_897n, true);
  if (options.hasAuthority) {
    bytes[12] = 1;
    bytes.set(new Uint8Array(getAddressEncoder().encode(AUTHORITY)), 13);
  }
  return bytes;
}

describe("decodeUpgradeAuthority", () => {
  it("reads the key out of a ProgramData header", () => {
    expect(decodeUpgradeAuthority(header({ hasAuthority: true }))).toEqual({
      kind: "key",
      authority: AUTHORITY,
    });
  });

  it("reports a renounced program", () => {
    expect(decodeUpgradeAuthority(header({ hasAuthority: false }))).toEqual({ kind: "none" });
  });

  it("refuses a header that is not ProgramData", () => {
    // Tag 2 is `Program`, tag 1 is `Buffer`. Reading either as ProgramData would report
    // whatever bytes happened to sit at offset 13 as the authority.
    expect(decodeUpgradeAuthority(header({ tag: 2, hasAuthority: true })).kind).toBe(
      "not-upgradeable",
    );
  });

  it("refuses a truncated account", () => {
    expect(decodeUpgradeAuthority(header({ hasAuthority: true }).subarray(0, 44)).kind).toBe(
      "not-upgradeable",
    );
  });
});
