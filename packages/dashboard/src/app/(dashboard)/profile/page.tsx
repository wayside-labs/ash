"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useDashboardState, useUpdateProfile } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { truncateAddress } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";

export default function ProfilePage() {
  const { t } = useTranslation();
  const { walletAddress, walletName } = useAppStore();
  const { data, isLoading } = useDashboardState();
  const save = useUpdateProfile();
  const toast = useToast();

  const [form, setForm] = useState({ displayName: "", company: "", bio: "", email: "" });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.profile && !dirty) setForm(data.profile);
  }, [data?.profile, dirty]);

  const set = (key: keyof typeof form) => (value: string) => {
    setDirty(true);
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const submit = async () => {
    try {
      await save.mutateAsync(form);
      setDirty(false);
      toast(t("common.profileSaved"));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToSave"), "error");
    }
  };

  return (
    <div>
      <PageHeader title={t("profile.title")} description={t("profile.description")} />

      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>{t("profile.personalInfo")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted text-2xl">
                  {form.displayName ? form.displayName.slice(0, 1).toUpperCase() : "👤"}
                </div>
                <p className="text-xs text-muted-foreground">{t("profile.avatarHint")}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pf-name">{t("profile.displayName")}</Label>
                <Input
                  id="pf-name"
                  value={form.displayName}
                  onChange={(e) => set("displayName")(e.target.value)}
                  placeholder={t("profile.displayNamePlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pf-company">{t("profile.company")}</Label>
                <Input
                  id="pf-company"
                  value={form.company}
                  onChange={(e) => set("company")(e.target.value)}
                  placeholder={t("profile.companyPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pf-email">{t("profile.email")}</Label>
                <Input
                  id="pf-email"
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email")(e.target.value)}
                  placeholder={t("profile.emailPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pf-bio">{t("profile.bio")}</Label>
                <Textarea
                  id="pf-bio"
                  rows={3}
                  value={form.bio}
                  onChange={(e) => set("bio")(e.target.value)}
                  placeholder={t("profile.bioPlaceholder")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="pf-wallet">{t("profile.primaryWallet")}</Label>
                <Input
                  id="pf-wallet"
                  readOnly
                  value={
                    walletAddress
                      ? `${walletName ? `${walletName} · ` : ""}${truncateAddress(walletAddress, 8)}`
                      : t("profile.noWalletConnected")
                  }
                  className="num"
                />
              </div>

              <Button onClick={submit} disabled={save.isPending || !dirty}>
                {save.isPending
                  ? t("common.saving")
                  : dirty
                    ? t("common.saveChanges")
                    : t("common.allSaved")}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
