"use client";

import Link from "next/link";
import { useTranslation } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";

/** The two legal pages, as a row of links; the one place their labels and hrefs live. */
export function LegalLinks({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("legal.nav")}
      className={cn("flex items-center gap-4 text-xs text-muted-foreground", className)}
    >
      <Link href="/terms" className="underline-offset-2 hover:text-foreground hover:underline">
        {t("legal.terms.link")}
      </Link>
      <Link href="/privacy" className="underline-offset-2 hover:text-foreground hover:underline">
        {t("legal.privacy.link")}
      </Link>
    </nav>
  );
}

/** “By continuing you agree to the Terms and the Privacy Policy.”, with both as links. */
export function LegalAgreement({ className }: { className?: string }) {
  const { t } = useTranslation();
  const link = "underline underline-offset-2 hover:text-foreground";
  return (
    <p className={cn("text-xs text-muted-foreground", className)} data-testid="legal-agreement">
      {t("legal.agree.prefix")}{" "}
      <Link href="/terms" className={link}>
        {t("legal.terms.link")}
      </Link>{" "}
      {t("legal.agree.and")}{" "}
      <Link href="/privacy" className={link}>
        {t("legal.privacy.link")}
      </Link>
      {t("legal.agree.suffix")}
    </p>
  );
}
