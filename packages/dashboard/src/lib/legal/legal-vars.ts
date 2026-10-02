import type { LegalVars } from "./types";

/**
 * A missing value renders as a visible bracket instead of an empty string, so an unfinished
 * deployment shows its gap on the page and does not publish terms with no named party.
 */
function fromEnv(name: string, hint: string): string {
  return process.env[name]?.trim() || `[${hint} — set ${name}]`;
}

export function legalVars(): LegalVars {
  return {
    entity: fromEnv("LEGAL_ENTITY_NAME", "operator legal name"),
    email: fromEnv("LEGAL_CONTACT_EMAIL", "contact email"),
    law: fromEnv("LEGAL_GOVERNING_LAW", "governing law and venue"),
  };
}
