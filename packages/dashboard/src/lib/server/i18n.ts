import { DEFAULT_LOCALE, type Locale, type TranslateParams, t as translate } from "@/i18n";
import { readState } from "@/lib/server/store";

export async function getDashboardLocale(): Promise<Locale> {
  const state = await readState();
  const lang = state.settings.language;
  return lang === "pt-BR" ? "pt-BR" : "en";
}

/** Server-side translation using the dashboard language preference. */
export async function serverT(key: string, params?: TranslateParams): Promise<string> {
  const locale = await getDashboardLocale();
  return translate(key, locale, params);
}

/** Sync variant when locale is already known. */
export function serverTWithLocale(locale: Locale, key: string, params?: TranslateParams): string {
  return translate(key, locale, params);
}

export { DEFAULT_LOCALE, type Locale };
