"use client";

import { useTranslation } from "@/i18n/locale-provider";
import { PRIVACY } from "@/lib/legal/privacy";
import { TERMS } from "@/lib/legal/terms";
import { fillLegalVars, type LegalKind, type LegalVars } from "@/lib/legal/types";

const DOCS = { terms: TERMS, privacy: PRIVACY } as const;

/**
 * Client-side only for the language: a signed-out visitor has no tenant settings to read it
 * from on the server, so the browser's stored locale decides, exactly as on the sign-in page.
 */
export function LegalDocument({ kind, vars }: { kind: LegalKind; vars: LegalVars }) {
  const { locale, t } = useTranslation();
  const doc = DOCS[kind][locale === "pt-BR" ? "pt-BR" : "en"];
  const fill = (text: string) => fillLegalVars(text, vars);

  return (
    <article>
      <h1 className="text-2xl font-semibold tracking-tight">{doc.title}</h1>
      <p className="mt-1 text-xs text-muted-foreground">
        {t("legal.updated", { date: doc.updated })}
      </p>
      <p className="mt-6 text-sm leading-6 text-muted-foreground">{fill(doc.intro)}</p>

      <ol className="mt-8 space-y-8">
        {doc.sections.map((section, index) => (
          <li key={section.id} id={section.id} className="scroll-mt-6">
            <h2 className="text-base font-semibold">
              {index + 1}. {section.heading}
            </h2>
            <div className="mt-2 space-y-3 text-sm leading-6 text-muted-foreground">
              {section.paragraphs.map((paragraph) => (
                <p key={paragraph}>{fill(paragraph)}</p>
              ))}
              {section.items && (
                <ul className="list-disc space-y-2 pl-5">
                  {section.items.map((item) => (
                    <li key={item}>{fill(item)}</li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </article>
  );
}
