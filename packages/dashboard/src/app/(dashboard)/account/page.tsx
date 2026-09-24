"use client";

import { Info, LogOut } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/toast";
import { ConnectButton } from "@/components/wallet/connect-button";
import { WalletSetupPrompt } from "@/components/wallet/wallet-setup-prompt";
import { useAuth } from "@/hooks/use-auth";
import { useTranslation } from "@/i18n/locale-provider";
import { truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

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

export default function AccountPage() {
  const { t } = useTranslation();
  const { walletAddress, walletName, setWallet } = useAppStore();
  const { configured, email, loading, signedIn, signOut } = useAuth();
  // Lifted so the post-login offer can open this page's picker directly.
  const [pickerOpen, setPickerOpen] = useState(false);
  const toast = useToast();

  return (
    <div>
      <Suspense fallback={null}>
        <AuthErrorToast />
      </Suspense>
      <WalletSetupPrompt onConnect={() => setPickerOpen(true)} />
      <PageHeader title={t("account.title")} description={t("account.description")} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("account.identity")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {walletAddress ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t("account.connectedWallet")}</p>
                  <p className="num text-sm">{truncateAddress(walletAddress, 8)}</p>
                  {walletName && <p className="text-xs text-muted-foreground">{walletName}</p>}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setWallet(null);
                    toast(t("common.walletDisconnected"));
                  }}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {t("common.disconnect")}
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("account.noWalletHint")}</p>
                <ConnectButton pickerOpen={pickerOpen} onPickerOpenChange={setPickerOpen} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("account.emailGoogleTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!configured ? (
              <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">{t("account.authNotConfigured")}</p>
              </div>
            ) : loading ? (
              <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
            ) : signedIn ? (
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground">{t("account.signedInAs")}</p>
                  <p className="text-sm">{email}</p>
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
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{t("account.signInHint")}</p>
                <GoogleSignInButton />
              </div>
            )}
            <Separator />
            <p className="text-xs text-muted-foreground">{t("account.walletSeparateNote")}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
