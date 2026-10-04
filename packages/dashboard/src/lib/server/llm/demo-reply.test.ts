import { describe, expect, it } from "vitest";
import { getDemoReply } from "./i18n";

const MESSAGES = ["hello", "how do I trade on kamino", "pay this vendor csv"];

describe("getDemoReply", () => {
  it("tells a local operator how to connect a model", () => {
    expect(getDemoReply("en", "hello")).toContain("Claude Code");
    expect(getDemoReply("en", "hello")).toContain("My APIs");
    expect(getDemoReply("pt-BR", "hello")).toContain("Minhas APIs");
  });

  // ADR-019 / ADR-026: a hosted visitor has no CLI and no My APIs key to reach for.
  it("never sends a hosted visitor to the CLI or to My APIs", () => {
    for (const locale of ["en", "pt-BR"] as const) {
      for (const message of MESSAGES) {
        const reply = getDemoReply(locale, message, { hosted: true });
        expect(reply).not.toMatch(/Claude Code|My APIs|Minhas APIs/);
        expect(reply).not.toContain("{connect}");
      }
    }
    expect(getDemoReply("en", "hello", { hosted: true })).toContain("Sign in");
  });
});
