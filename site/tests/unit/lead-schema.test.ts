import { describe, it, expect } from "vitest";
import { validateLead } from "../../src/lib/lead-schema";

const good = { name: "Ana Souza", role: "Partner", kind: "investor", email: "ana@exemplo.com", lang: "pt", consent: true };

describe("validateLead", () => {
  it("accepts a complete lead, trimming text and lower-casing the e-mail", () => {
    const r = validateLead({ ...good, name: "  Ana Souza ", email: " Ana@Exemplo.COM " });
    expect(r).toEqual({ ok: true, lead: { ...good, email: "ana@exemplo.com" } });
  });
  it.each([
    ["name", { name: "   " }],
    ["name", { name: "a".repeat(81) }],
    ["role", { role: "" }],
    ["kind", { kind: "whale" }],
    ["email", { email: "ana.exemplo.com" }],
    ["email", { email: "ana@exemplo" }],
    ["email", { email: `${"a".repeat(250)}@x.com` }],
    ["consent", { consent: false }],
    ["consent", { consent: "yes" }],
    ["lang", { lang: "es" }],
  ])("rejects a bad %s", (field, patch) => {
    const r = validateLead({ ...good, ...patch });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors).toContain(field);
  });
  it("rejects something that is not an object at all", () => {
    expect(validateLead(null).ok).toBe(false);
    expect(validateLead("ana").ok).toBe(false);
  });
  it("reports every bad field at once", () => {
    const r = validateLead({ lang: "pt" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.sort()).toEqual(["consent", "email", "kind", "name", "role"]);
  });
});
