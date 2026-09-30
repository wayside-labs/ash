"use client";

import { Loader2, Mail, MailCheck } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "@/i18n/locale-provider";

/**
 * The default door (ADR-024): an address and a link. No password to forget, no extension to
 * install, and it works from a phone's browser.
 */
export function EmailSignInForm() {
  const { t } = useTranslation();
  const toast = useToast();
  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  if (sentTo) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
        <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="space-y-1">
          <p className="text-sm" data-testid="magic-link-sent">
            {t("account.email.sent", { email: sentTo })}
          </p>
          <button
            type="button"
            className="text-xs text-muted-foreground underline underline-offset-2"
            onClick={() => setSentTo(null)}
          >
            {t("account.email.useAnother")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-2 sm:flex-row"
      onSubmit={async (event) => {
        event.preventDefault();
        const address = email.trim();
        if (!address) return;
        setPending(true);
        try {
          await signInWithEmail(address);
          setSentTo(address);
        } catch (error) {
          toast(error instanceof Error ? error.message : t("account.authError"), "error");
        } finally {
          setPending(false);
        }
      }}
    >
      <Input
        id="sign-in-email"
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        placeholder={t("account.email.placeholder")}
        aria-label={t("account.email.label")}
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="sm:flex-1"
      />
      <Button type="submit" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        {t("account.email.submit")}
      </Button>
    </form>
  );
}
