import en from "./locales/en.json";
import ptBR from "./locales/pt-BR.json";

export type Locale = "en" | "pt-BR";
export type MessageKey = keyof typeof en;

const catalogs: Record<Locale, Record<string, string>> = {
  en,
  "pt-BR": ptBR,
};

/** Default UI locale. English is the source of truth in the JSON catalogs. */
export const DEFAULT_LOCALE: Locale = "en";

export function getMessages(locale: Locale): Record<string, string> {
  return catalogs[locale] ?? catalogs.en;
}

/** BCP 47 tag for Intl formatters. */
export function intlLocale(locale: Locale): string {
  return locale === "pt-BR" ? "pt-BR" : "en-US";
}

export type TranslateParams = Record<string, string | number>;

/** Resolve a dotted key with optional `{placeholder}` interpolation. Falls back to English, then the key. */
export function t(key: string, locale: Locale = DEFAULT_LOCALE, params?: TranslateParams): string {
  let text = getMessages(locale)[key] ?? getMessages("en")[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}
