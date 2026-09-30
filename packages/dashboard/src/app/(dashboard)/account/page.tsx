"use client";

import { ChevronDown, Info, LogOut } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { EmailSignInForm } from "@/components/auth/email-sign-in-form";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { WalletSignInButton } from "@/components/auth/wallet-sign-in-button";
import { CreditCard } from "@/components/billing/credit-card";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "@/i18n/locale-provider";

function AuthErrorToast() {
  const searchParams = useSearchParams();
  const toast = useToast();
  const { t } = useTranslation();

  useEffect(() => {
    const error = searchParams.get("error");
    if (!error) return;
    const key =
      error === "bootstrap"
        ? "account.authBootstrapError"
        : error === "supabase"
          ? "account.authSupabaseError"
          : "account.authError";
    toast(t(key), "error");
  }, [searchParams, t, toast]);

  return null;
}

/**
 * Also the sign-in page: the middleware sends signed-out visitors here (ADR-017), so the
 * signed-out state is the product's front door and leads with the one path that needs nothing
 * installed (ADR-024).
 */
export default function AccountPage() {
  const { t } = useTranslation();
  const { configured, label, loading, signedIn, signOut } = useAuth();
  const toast = useToast();

  return (
    <div>
      <Suspense fallback={null}>
        <AuthErrorToast />
      </Suspense>
      <PageHeader title={t("account.title")} description={t("account.description")} />

      {!configured ? (
        // Local JSON mode: no accounts. Linking a wallet is an operator task, on Advanced › Wallets.
        <div className="grid max-w-2xl gap-4">
          <Card>
            <CardContent className="flex items-start gap-2 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">{t("account.authNotConfigured")}</p>
            </CardContent>
          </Card>
        </div>
      ) : loading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : !signedIn ? (
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>{t("account.signIn.title")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{t("account.signInHint")}</p>
            <EmailSignInForm />
            <div className="flex items-center gap-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">{t("account.signIn.or")}</span>
              <Separator className="flex-1" />
            </div>
            <GoogleSignInButton />
            <details className="group">
              <summary className="flex cursor-pointer list-none items-center gap-1 text-xs text-muted-foreground">
                <ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                {t("account.signIn.walletDisclosure")}
              </summary>
              <div className="mt-3 space-y-2">
                <WalletSignInButton />
                <p className="text-xs text-muted-foreground">{t("account.walletSignInHint")}</p>
              </div>
            </details>
          </CardContent>
        </Card>
      ) : (
        // The customer's account is who they are and their credit. Wallets — the platform one
        // and linking one's own — are on-chain matters and live under Advanced › Wallets.
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("account.identity")}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground">{t("account.signedInAs")}</p>
                <p className="text-sm">{label}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  await signOut();
                  toast(t("account.signedOut"));
                }}
              >
                <LogOut className="h-3.5 w-3.5" />
                {t("account.signOut")}
              </Button>
            </CardContent>
          </Card>
          <CreditCard />
        </div>
      )}
    </div>
  );
}
