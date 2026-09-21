"use client";

import { createContext, useContext, useEffect, useMemo } from "react";
import { useDashboardState } from "@/hooks/use-dashboard";
import { DEFAULT_LOCALE, type Locale, type TranslateParams, t as translate } from "@/i18n";
import { useAppStore } from "@/stores/app-store";

export type TFunction = (key: string, params?: TranslateParams) => string;

const LocaleContext = createContext<{ locale: Locale; t: TFunction }>({
  locale: DEFAULT_LOCALE,
  t: (key) => key,
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const locale = useAppStore((s) => s.locale);
  const setLocale = useAppStore((s) => s.setLocale);
  const { data } = useDashboardState();

  // Server settings win once loaded; until then the persisted store locale renders immediately.
  useEffect(() => {
    const lang = data?.settings.language;
    if (lang === "en" || lang === "pt-BR") setLocale(lang);
  }, [data?.settings.language, setLocale]);

  useEffect(() => {
    document.documentElement.lang = locale === "pt-BR" ? "pt-BR" : "en";
  }, [locale]);

  const value = useMemo(
    () => ({
      locale,
      t: (key: string, params?: TranslateParams) => translate(key, locale, params),
    }),
    [locale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useTranslation() {
  return useContext(LocaleContext);
}

export function useLocale(): Locale {
  return useContext(LocaleContext).locale;
}
