"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "@/i18n/locale-provider";

export function GoogleSignInButton() {
  const { t } = useTranslation();
  const toast = useToast();
  const { signInWithGoogle } = useAuth();
  const [pending, setPending] = useState(false);

  return (
    <Button
      disabled={pending}
      onClick={async () => {
        setPending(true);
        try {
          await signInWithGoogle();
        } catch (error) {
          const message = error instanceof Error ? error.message : t("account.authError");
          toast(message, "error");
          setPending(false);
        }
      }}
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      {t("account.signInWithGoogle")}
    </Button>
  );
}
