import { describe, expect, it } from "vitest";
import { canConnectExternalWallet, parseExternalWalletPolicy } from "./plan";

describe("canConnectExternalWallet", () => {
  it("keeps the extension for a free hosted account out by default", () => {
    expect(canConnectExternalWallet({ hosted: true, plan: "free", policy: "pro" })).toBe(false);
  });

  it("lets a Pro hosted account in", () => {
    expect(canConnectExternalWallet({ hosted: true, plan: "pro", policy: "pro" })).toBe(true);
  });

  it("lets everyone in when the deployment opts out of the gate", () => {
    expect(canConnectExternalWallet({ hosted: true, plan: "free", policy: "everyone" })).toBe(true);
  });

  it("never gates local mode, where the extension is the only signer", () => {
    expect(canConnectExternalWallet({ hosted: false, plan: "free", policy: "pro" })).toBe(true);
  });
});

describe("parseExternalWalletPolicy", () => {
  it.each([
    [undefined, "pro"],
    ["", "pro"],
    ["pro", "pro"],
    ["everyone", "everyone"],
    [" Everyone ", "everyone"],
    ["all", "pro"],
  ])("%j -> %s", (raw, expected) => {
    expect(parseExternalWalletPolicy(raw)).toBe(expected);
  });
});
