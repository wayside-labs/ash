"use client";

import { Eye, EyeOff, KeyRound, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { useState } from "react";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useCreateResource, useDashboardState, useDeleteResource } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";

const PROVIDERS = ["Anthropic", "OpenAI", "Helius", "Other"];

export default function ApisPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useDashboardState();
  const create = useCreateResource("apiKeys");
  const remove = useDeleteResource("apiKeys");
  const toast = useToast();
  const [visible, setVisible] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(PROVIDERS[0]);
  const [secret, setSecret] = useState("");

  const keys = data?.apiKeys ?? [];

  const providerLabel = (p: string) => (p === "Other" ? t("apis.provider.other") : p);

  const submit = async () => {
    if (!secret.trim()) return;
    try {
      await create.mutateAsync({ provider, secret: secret.trim() });
      toast(t("apis.keySaved", { provider: provider ?? "" }));
      setSecret("");
      setOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToSave"), "error");
    }
  };

  return (
    <div>
      <PageHeader
        title={t("apis.title")}
        description={t("apis.description")}
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("apis.addProvider")}
          </Button>
        }
      />

      <Card className="mb-6 border-primary/30 bg-primary/5">
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="text-sm">
            <p className="font-medium">{t("apis.securityTitle")}</p>
            <p className="text-muted-foreground">{t("apis.securityDescription")}</p>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : keys.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title={t("apis.emptyTitle")}
          description={t("apis.emptyDescription")}
          action={{ label: t("apis.addKey"), onClick: () => setOpen(true) }}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {keys.map((api) => (
            <Card key={api.id}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle>{api.provider}</CardTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={api.status === "connected" ? "success" : "secondary"}>
                      {api.status === "connected"
                        ? t("apis.status.connected")
                        : t("apis.status.empty")}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("apis.aria.removeKey", { provider: api.provider })}
                      onClick={() => remove.mutate(api.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Label className="mb-2 block text-xs text-muted-foreground">
                  {t("common.key")}
                </Label>
                <div className="flex gap-2">
                  <Input
                    type={visible[api.id] ? "text" : "password"}
                    value={api.keyMasked}
                    readOnly
                    className="num text-sm"
                  />
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={visible[api.id] ? t("common.hide") : t("common.show")}
                    onClick={() => setVisible((v) => ({ ...v, [api.id]: !v[api.id] }))}
                  >
                    {visible[api.id] ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{t("apis.maskNote")}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("apis.dialog.title")}</DialogTitle>
            <DialogDescription>{t("apis.dialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("common.provider")}</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {providerLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="api-secret">{t("common.key")}</Label>
              <Input
                id="api-secret"
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                placeholder="sk-ant-…"
                className="num"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={submit} disabled={!secret.trim() || create.isPending}>
              {t("common.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
