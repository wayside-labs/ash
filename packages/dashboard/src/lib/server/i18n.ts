import { DEFAULT_LOCALE, type Locale, type TranslateParams, t as translate } from "@/i18n";
import { readState, StateAccessError } from "@/lib/server/store";

/**
 * Language is presentation, not tenant data: a caller whose state is
 * unreadable still has to render its own 401/422 body, so an inaccessible
 * state falls back to the default rather than turning every such response
 * into a 500.
 */
export async function getDashboardLocale(): Promise<Locale> {
  let state: Awaited<ReturnType<typeof readState>>;
  try {
    state = await readState();
  } catch (error) {
    if (error instanceof StateAccessError) return DEFAULT_LOCALE;
    throw error;
  }
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
