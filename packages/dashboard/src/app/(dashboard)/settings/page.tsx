"use client";

import { AlertTriangle, CheckCircle2, Download, Loader2, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { ChannelsCard } from "@/components/settings/channels-card";
import { PageHeader } from "@/components/shared/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  useDashboardState,
  useResetState,
  useRpcHealth,
  useUpdateSettings,
} from "@/hooks/use-dashboard";
import type { Locale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import { CLUSTER_LABELS } from "@/lib/solana";
import type { SolanaCluster } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

export default function SettingsPage() {
  const { t } = useTranslation();
  const { cluster, customRpc, setCluster, setCustomRpc, setLocale } = useAppStore();
  const { data, isLoading } = useDashboardState();
  const saveSettings = useUpdateSettings();
  const reset = useResetState();
  const health = useRpcHealth();
  const toast = useToast();

  const [rpcInput, setRpcInput] = useState(customRpc);
  useEffect(() => setRpcInput(customRpc), [customRpc]);

  const settings = data?.settings;

  const patch = async (partial: Record<string, unknown>) => {
    if (!settings) return;
    const lang = partial.language;
    if (lang === "en" || lang === "pt-BR") setLocale(lang as Locale);
    try {
      await saveSettings.mutateAsync({ ...settings, ...partial });
      toast(t("common.preferenceSaved"));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToSave"), "error");
    }
  };

  const testRpc = async () => {
    const result = await health.mutateAsync({ cluster, rpc: rpcInput.trim() || null });
    toast(
      result.ok
        ? t("settings.rpcResponding", { detail: result.detail })
        : t("settings.rpcFailed", { detail: result.detail }),
      result.ok ? "success" : "error",
    );
  };

  const exportConfig = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ash-dashboard.json";
    a.click();
    URL.revokeObjectURL(url);
    toast(t("common.configExported"));
  };

  const restoreDefaults = async () => {
    if (!window.confirm(t("settings.restoreConfirm"))) {
      return;
    }
    try {
      await reset.mutateAsync();
      toast(t("common.dataRestored"));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToRestore"), "error");
    }
  };

  return (
    <div>
      <PageHeader title={t("settings.title")} description={t("settings.description")} />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings.solanaNetwork")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t("settings.defaultCluster")}</Label>
              <Select value={cluster} onValueChange={(v) => setCluster(v as SolanaCluster)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(CLUSTER_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <Label htmlFor="rpc">{t("settings.customRpc")}</Label>
              <Input
                id="rpc"
                placeholder="https://devnet.helius-rpc.com/?api-key=…"
                value={rpcInput}
                onChange={(e) => setRpcInput(e.target.value)}
                onBlur={() => setCustomRpc(rpcInput)}
              />
              <p className="text-xs text-muted-foreground">{t("settings.customRpcHint")}</p>
              <Button variant="outline" size="sm" onClick={testRpc} disabled={health.isPending}>
                {health.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                )}
                {t("common.testConnection")}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings.preferences")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isLoading || !settings ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("common.loading")}
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label>{t("settings.language")}</Label>
                  <Select value={settings.language} onValueChange={(v) => patch({ language: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="pt-BR">Português (BR)</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">{t("settings.languageNote")}</p>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>{t("settings.limitAlerts")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.limitAlertsDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={settings.limitAlerts}
                    onCheckedChange={(checked) => patch({ limitAlerts: checked })}
                    aria-label={t("settings.limitAlerts")}
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <Label>{t("settings.emailNotifications")}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.emailNotificationsDescription")}
                    </p>
                  </div>
                  <Switch
                    checked={settings.emailNotifications}
                    onCheckedChange={(checked) => patch({ emailNotifications: checked })}
                    aria-label={t("settings.emailNotifications")}
                  />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <ChannelsCard />

        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle>{t("settings.data")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("settings.dataStorageNote")}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={exportConfig} disabled={!data}>
                <Download className="h-4 w-4" />
                {t("common.exportConfiguration")}
              </Button>
              <Button variant="destructive" onClick={restoreDefaults} disabled={reset.isPending}>
                <RotateCcw className="h-4 w-4" />
                {t("common.restoreDefaults")}
              </Button>
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              {t("settings.restoreWarning")}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
