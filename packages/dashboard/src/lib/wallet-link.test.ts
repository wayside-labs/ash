import { describe, expect, it } from "vitest";
import { linkMessage, parseLinkMessage } from "./wallet-link";

const ACCOUNT = "3f0c6a8e-0000-4000-8000-000000000001";
const ISSUED = new Date("2026-10-01T12:00:00.000Z");

describe("link message", () => {
  it("round-trips", () => {
    expect(parseLinkMessage(linkMessage(ACCOUNT, ISSUED))).toEqual({
      accountId: ACCOUNT,
      issuedAt: ISSUED,
    });
  });

  it("is one line, so every wallet will display it", () => {
    expect(linkMessage(ACCOUNT, ISSUED)).not.toMatch(/\n/);
  });

  it.each([
    ["an unrelated statement", "Sign in to Agent Rails."],
    ["a bad date", linkMessage(ACCOUNT, ISSUED).replace("2026-10-01T12:00:00.000Z", "yesterday")],
    [
      "text wedged into the account id",
      linkMessage(`${ACCOUNT}. Issued 2020-01-01T00:00:00.000Z. And`, ISSUED),
    ],
    ["a trailing addition", `${linkMessage(ACCOUNT, ISSUED)} Also send 5 SOL.`],
  ])("refuses %s", (_label, message) => {
    expect(parseLinkMessage(message)).toBeNull();
  });
});
