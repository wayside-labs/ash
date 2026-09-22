import { describe, expect, it } from "vitest";
import { CliError } from "./errors.js";
import { parseAddress } from "./parse.js";

describe("parseAddress", () => {
  it("accepts a base58 address", () => {
    const value = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
    expect(parseAddress(value, "--destination")).toBe(value);
  });

  // The flag is in the message because the CLI takes several addresses per command, and
  // "not a valid Solana address" alone leaves the operator guessing which one.
  it.each([
    ["empty", ""],
    ["too short", "abc"],
    ["non-base58 characters", "0OIl111111111111111111111111111111111111111"],
    ["a 64-char hex string", "a".repeat(64)],
  ])("rejects %s and names the flag", (_label, value) => {
    expect(() => parseAddress(value, "--destination")).toThrow(CliError);
    expect(() => parseAddress(value, "--destination")).toThrow(/--destination is not a valid/);
  });

  it("keeps the original error as the cause", () => {
    try {
      parseAddress("nope", "--treasury");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as CliError).cause).toBeDefined();
    }
  });
});
