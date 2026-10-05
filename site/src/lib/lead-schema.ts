// One validator for both sides: the browser uses it for instant field errors, the Pages Function
// runs it again because nothing the client sends is trusted.
export const KINDS = ["investor", "founder", "other"] as const;
export type Kind = (typeof KINDS)[number];
export type LeadLang = "en" | "pt";
export interface Lead { name: string; role: string; kind: Kind; email: string; lang: LeadLang; consent: true }
export type LeadField = "name" | "role" | "kind" | "email" | "lang" | "consent";
export type LeadResult = { ok: true; lead: Lead } | { ok: false; errors: LeadField[] };

// Deliberately loose: the double opt-in e-mail is the real check that the address works.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

export function validateLead(input: unknown): LeadResult {
  if (!input || typeof input !== "object") return { ok: false, errors: ["name", "role", "kind", "email", "lang", "consent"] };
  const o = input as Record<string, unknown>;
  const name = text(o.name);
  const role = text(o.role);
  const email = text(o.email).toLowerCase();
  const errors: LeadField[] = [];
  if (name.length < 1 || name.length > 80) errors.push("name");
  if (role.length < 1 || role.length > 80) errors.push("role");
  if (!KINDS.includes(o.kind as Kind)) errors.push("kind");
  if (email.length > 254 || !EMAIL.test(email)) errors.push("email");
  if (o.lang !== "en" && o.lang !== "pt") errors.push("lang");
  if (o.consent !== true) errors.push("consent");
  if (errors.length) return { ok: false, errors };
  return { ok: true, lead: { name, role, kind: o.kind as Kind, email, lang: o.lang as LeadLang, consent: true } };
}
