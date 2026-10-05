import { stripTags } from "./body-content";

const WORDS_PER_MINUTE = 200;

// The shortcode grammar, not "anything between braces": [^}]* made a run of "{{" quadratic
// (95 s at the body cap).
const SHORTCODE_RE = /\{\{[a-z]+(?::[a-z0-9-]+)?\}\}/g;

export function readingTimeMinutes(bodyHtml: string): number {
  const text = stripTags(bodyHtml.replace(SHORTCODE_RE, " "), " ").trim();

  if (!text) return 1;
  const words = text.split(/\s+/).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
