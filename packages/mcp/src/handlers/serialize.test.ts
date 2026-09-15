import { describe, expect, it } from "vitest";
import { bytesToHex, decodePaddedUtf8, destinationModeLabel } from "./serialize.js";

describe("serialize helpers", () => {
  it("decodes zero-padded UTF-8 labels", () => {
    const bytes = new Uint8Array(32);
    bytes.set(new TextEncoder().encode("billing-agent"));
    expect(decodePaddedUtf8(bytes)).toBe("billing-agent");
  });

  it("hex-encodes byte arrays", () => {
    expect(bytesToHex(new Uint8Array([0xab, 0xcd]))).toBe("abcd");
  });

  it("maps destination modes to labels", () => {
    expect(destinationModeLabel(0)).toBe("any");
    expect(destinationModeLabel(1)).toBe("allowlist");
    expect(destinationModeLabel(9)).toBe("unknown(9)");
  });
});
