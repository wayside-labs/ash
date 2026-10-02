import { describe, expect, it } from "vitest";
import { needsSignIn, safeNext, signInUrl } from "./sign-in-gate";

describe("needsSignIn", () => {
  it.each(["/", "/treasury", "/apis", "/workflows/wf_1", "/settings"])("gates %s", (path) => {
    expect(needsSignIn(path)).toBe(true);
  });

  it.each([
    "/account",
    "/terms",
    "/privacy",
    "/api/state",
    "/api/state/apiKeys",
    "/api/solana/price",
    "/auth/callback",
    "/_next/data/x.json",
    "/manifest.json",
    "/favicon.ico",
    "/icon.svg",
  ])("lets %s through", (path) => {
    expect(needsSignIn(path)).toBe(false);
  });

  it("opens the legal pages by exact path only", () => {
    expect(needsSignIn("/terms/")).toBe(true);
    expect(needsSignIn("/terms/extra")).toBe(true);
    expect(needsSignIn("/privacy-settings")).toBe(true);
  });

  it("does not treat a prefix as the sign-in page", () => {
    expect(needsSignIn("/accounts")).toBe(true);
    expect(needsSignIn("/apis")).toBe(true);
  });
});

describe("signInUrl", () => {
  it("drops next for the home page", () => {
    expect(signInUrl("/", "")).toBe("/account");
  });

  it("keeps path and query in next", () => {
    expect(signInUrl("/treasury", "?tab=vaults")).toBe("/account?next=%2Ftreasury%3Ftab%3Dvaults");
  });
});

describe("safeNext", () => {
  it.each([
    "https://evil.example",
    "//evil.example",
    "/\\evil.example",
    "/\t/evil.example",
    "/\n/evil.example",
    null,
    undefined,
    "",
  ])("rejects %s", (next) => {
    expect(safeNext(next)).toBe("/account");
  });

  it("accepts a same-site path", () => {
    expect(safeNext("/treasury?tab=1")).toBe("/treasury?tab=1");
  });
});
