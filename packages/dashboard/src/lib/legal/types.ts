export type LegalKind = "terms" | "privacy";

export type LegalSection = {
  id: string;
  heading: string;
  paragraphs: string[];
  /** Rendered as a bullet list after the paragraphs. */
  items?: string[];
};

export type LegalDoc = {
  title: string;
  /** Shown as "Last updated". Bump it with any change to the copy, however small. */
  updated: string;
  intro: string;
  sections: LegalSection[];
};

/**
 * Facts only the operator knows. They are read from the environment at request time
 * (`legal-vars.ts`) rather than written here: a legal name guessed into source would be
 * published as a statement of fact.
 */
export type LegalVars = {
  entity: string;
  email: string;
  law: string;
};

export function fillLegalVars(text: string, vars: LegalVars): string {
  return text
    .replaceAll("{entity}", vars.entity)
    .replaceAll("{email}", vars.email)
    .replaceAll("{law}", vars.law);
}
