"use client";

import { BellRing, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  useCreateResource,
  useDashboardState,
  useDeleteResource,
  useUpdateResource,
} from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { CHANNEL_EVENT_KINDS, type ChannelKind } from "@/lib/schema";

const KINDS: ChannelKind[] = ["webhook", "slack", "telegram", "email"];

const PLACEHOLDER: Record<ChannelKind, string> = {
  webhook: "https://example.com/ash",
  slack: "https://hooks.slack.com/services/T000/B000/XXXX",
  telegram: "123456789:AAE…#-1001234567890",
  email: "ops@example.com",
};

/**
 * Where agent events go besides the Reviews page. The target is masked on every read, so
 * the list shows kind, name and the last delivery, never the URL or token itself.
 */
export function ChannelsCard() {
  const { t, locale } = useTranslation();
  const { data } = useDashboardState();
  const create = useCreateResource("integrations");
  const update = useUpdateResource("integrations");
  const remove = useDeleteResource("integrations");
  const toast = useToast();
  const [kind, setKind] = useState<ChannelKind>("webhook");
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");

  const channels = data?.integrations ?? [];

  const add = async () => {
    try {
      await create.mutateAsync({
        name: name.trim() || t(`settings.channels.kind.${kind}`),
        kind,
        target: target.trim(),
        enabled: true,
      });
      setName("");
      setTarget("");
      toast(t("settings.channels.added"));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToSave"), "error");
    }
  };

  const toggleEvent = (id: string, events: string[], event: string) =>
    update.mutate({
      id,
      events: events.includes(event) ? events.filter((e) => e !== event) : [...events, event],
    });

  return (
    <Card className="md:col-span-2" data-testid="channels-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BellRing className="h-4 w-4" />
          {t("settings.channels.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">{t("settings.channels.description")}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        {channels.length > 0 && (
          <ul className="space-y-2">
            {channels.map((channel) => (
              <li key={channel.id} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t(`settings.channels.kind.${channel.kind}`)}</Badge>
                  <span className="font-medium">{channel.name}</span>
                  {channel.kind === "email" && (
                    <span className="text-xs text-muted-foreground">{channel.target}</span>
                  )}
                  {channel.lastError ? (
                    <Badge variant="destructive" title={channel.lastError}>
                      {t("settings.channels.failing")}
                    </Badge>
                  ) : channel.lastDeliveryAt ? (
                    <Badge variant="success">
                      {t("settings.channels.delivered", {
                        when: new Date(channel.lastDeliveryAt).toLocaleString(locale),
                      })}
                    </Badge>
                  ) : null}
                  <div className="ml-auto flex items-center gap-2">
                    <Switch
                      checked={channel.enabled}
                      onCheckedChange={(enabled) => update.mutate({ id: channel.id, enabled })}
                      aria-label={t("settings.channels.enable", { name: channel.name })}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={t("settings.channels.remove", { name: channel.name })}
                      onClick={() => remove.mutate(channel.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {CHANNEL_EVENT_KINDS.map((event) => (
                    <button
                      key={event}
                      type="button"
                      onClick={() => toggleEvent(channel.id, channel.events, event)}
                      className="rounded-full"
                    >
                      <Badge variant={channel.events.includes(event) ? "default" : "outline"}>
                        {t(`reviews.eventKind.${event}`)}
                      </Badge>
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-3 sm:grid-cols-[140px_1fr_2fr_auto] sm:items-end">
          <div className="space-y-1">
            <Label>{t("settings.channels.kindLabel")}</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as ChannelKind)}>
              <SelectTrigger aria-label={t("settings.channels.kindLabel")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`settings.channels.kind.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="channel-name">{t("common.name")}</Label>
            <Input id="channel-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="channel-target">{t(`settings.channels.target.${kind}`)}</Label>
            <Input
              id="channel-target"
              value={target}
              placeholder={PLACEHOLDER[kind]}
              onChange={(e) => setTarget(e.target.value)}
            />
          </div>
          <Button onClick={add} disabled={!target.trim() || create.isPending}>
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            {t("settings.channels.add")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t(`settings.channels.hint.${kind}`)}</p>
      </CardContent>
    </Card>
  );
}
