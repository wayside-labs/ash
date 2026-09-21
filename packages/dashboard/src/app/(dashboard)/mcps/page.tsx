"use client";

import { Cable, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  useCreateResource,
  useDashboardState,
  useDeleteResource,
  useUpdateResource,
} from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { envKeySchema, type Scope } from "@/lib/schema";
import type { McpServer } from "@/lib/types";

function scopeLabel(scope: Scope, t: (key: string) => string): string {
  switch (scope) {
    case "global":
      return t("common.global");
    case "workflow":
      return t("common.byWorkflowLower");
    case "agent":
      return t("common.byAgentLower");
  }
}

/** Ordered rows, because a Record loses the order the user typed them in. */
type EnvRow = { key: string; value: string };

interface McpDraft {
  name: string;
  description: string;
  scope: Scope;
  command: string;
  /** One argument per line. Split on save — never shell-split. */
  argsText: string;
  env: EnvRow[];
}

const BLANK: McpDraft = {
  name: "",
  description: "",
  scope: "global",
  command: "",
  argsText: "",
  env: [],
};

function draftFrom(mcp: McpServer): McpDraft {
  return {
    name: mcp.name,
    description: mcp.description,
    scope: mcp.scope,
    command: mcp.command,
    argsText: mcp.args.join("\n"),
    env: Object.entries(mcp.env).map(([key, value]) => ({ key, value })),
  };
}

function parseArgs(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
}

/** First problem with the env block, or null when it is saveable. */
function envProblem(rows: EnvRow[], t: (key: string) => string): string | null {
  const named = rows.filter((row) => row.key.trim() !== "");
  if (named.some((row) => !envKeySchema.safeParse(row.key.trim()).success)) {
    return t("mcps.invalidEnvKey");
  }
  const keys = named.map((row) => row.key.trim());
  if (new Set(keys).size !== keys.length) return t("mcps.duplicateEnvKey");
  return null;
}

function EnvEditor({ rows, onChange }: { rows: EnvRow[]; onChange: (rows: EnvRow[]) => void }) {
  const { t } = useTranslation();
  const patch = (index: number, row: Partial<EnvRow>) =>
    onChange(rows.map((current, i) => (i === index ? { ...current, ...row } : current)));

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        // Index keys are correct here: rows are positional and a key rename
        // must not remount the input mid-keystroke.
        // biome-ignore lint/suspicious/noArrayIndexKey: positional rows
        <div key={index} className="flex gap-2">
          <Input
            value={row.key}
            onChange={(e) => patch(index, { key: e.target.value })}
            placeholder={t("mcps.envKeyPlaceholder")}
            spellCheck={false}
            className="w-2/5 font-mono text-xs"
          />
          <Input
            value={row.value}
            onChange={(e) => patch(index, { value: e.target.value })}
            placeholder={t("mcps.envValuePlaceholder")}
            type="password"
            spellCheck={false}
            className="flex-1 font-mono text-xs"
          />
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("mcps.aria.removeEnvVar", { name: row.key || t("common.noLabel") })}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
      >
        <Plus className="h-3.5 w-3.5" />
        {t("mcps.addEnvVar")}
      </Button>
    </div>
  );
}

function McpDialog({
  open,
  onOpenChange,
  initial,
  title,
  description,
  submitLabel,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: McpDraft;
  title: string;
  description: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (draft: McpDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof McpDraft>(key: K, value: McpDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const envError = envProblem(draft.env, t);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="mcp-name">{t("common.name")}</Label>
            <Input id="mcp-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mcp-desc">{t("common.description")}</Label>
            <Input
              id="mcp-desc"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="mcp-command">{t("mcps.command")}</Label>
            <Input
              id="mcp-command"
              value={draft.command}
              onChange={(e) => set("command", e.target.value)}
              placeholder={t("mcps.commandPlaceholder")}
              spellCheck={false}
              className="font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">{t("mcps.commandHint")}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="mcp-args">{t("mcps.args")}</Label>
            <Textarea
              id="mcp-args"
              value={draft.argsText}
              onChange={(e) => set("argsText", e.target.value)}
              placeholder={t("mcps.argsPlaceholder")}
              spellCheck={false}
              className="min-h-[96px] font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">{t("mcps.argsHint")}</p>
          </div>
          <div className="space-y-2">
            <Label>{t("mcps.env")}</Label>
            <EnvEditor rows={draft.env} onChange={(rows) => set("env", rows)} />
            <p className="text-xs text-muted-foreground">{t("mcps.envHint")}</p>
            {envError && <p className="text-xs text-destructive">{envError}</p>}
          </div>
          <div className="space-y-2">
            <Label>{t("common.scope")}</Label>
            <Select value={draft.scope} onValueChange={(v) => set("scope", v as Scope)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="global">{t("common.global")}</SelectItem>
                <SelectItem value="workflow">{t("common.byWorkflowLower")}</SelectItem>
                <SelectItem value="agent">{t("common.byAgentLower")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={() => onSubmit(draft)}
            disabled={!draft.name.trim() || envError !== null || pending}
          >
            {submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The saved shape of a draft, minus the fields only the caller knows. */
function payload(draft: McpDraft) {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    scope: draft.scope,
    command: draft.command.trim(),
    args: parseArgs(draft.argsText),
    env: Object.fromEntries(
      draft.env.filter((row) => row.key.trim() !== "").map((row) => [row.key.trim(), row.value]),
    ),
  };
}

export default function McpsPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useDashboardState();
  const update = useUpdateResource("mcps");
  const remove = useDeleteResource("mcps");
  const create = useCreateResource("mcps");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<McpServer | null>(null);

  const toggle = async (id: string, enabled: boolean, label: string) => {
    try {
      await update.mutateAsync({ id, enabled });
      toast(
        enabled
          ? t("common.itemEnabled", { name: label })
          : t("common.itemDisabled", { name: label }),
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToSave"), "error");
    }
  };

  const submitCreate = async (draft: McpDraft) => {
    try {
      await create.mutateAsync({ ...payload(draft), enabled: false, demo: false });
      toast(t("mcps.added", { name: draft.name.trim() }));
      setOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToAdd"), "error");
    }
  };

  const submitEdit = async (mcp: McpServer, draft: McpDraft) => {
    try {
      await update.mutateAsync({ id: mcp.id, ...payload(draft) });
      toast(t("mcps.updated", { name: draft.name.trim() }));
      setEditing(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToSave"), "error");
    }
  };

  return (
    <div>
      <PageHeader
        title={t("mcps.title")}
        description={t("mcps.description")}
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("mcps.addMcp")}
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : (data?.mcps.length ?? 0) === 0 ? (
        <EmptyState
          icon={Cable}
          title={t("mcps.emptyTitle")}
          description={t("mcps.emptyDescription")}
          action={{ label: t("mcps.addMcp"), onClick: () => setOpen(true) }}
        />
      ) : (
        <div className="grid gap-3">
          {data?.mcps.map((mcp) => (
            <Card key={mcp.id}>
              <CardContent className="flex items-center justify-between gap-4 p-4">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{mcp.name}</span>
                    <Badge variant="outline">{scopeLabel(mcp.scope, t)}</Badge>
                    {mcp.scopeName && (
                      <span className="text-xs text-muted-foreground">{mcp.scopeName}</span>
                    )}
                    {mcp.demo && <DemoBadge />}
                  </div>
                  <p className="text-sm text-muted-foreground">{mcp.description}</p>
                  {/* The invocation, verbatim — what the export will spawn. */}
                  {mcp.command ? (
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {[mcp.command, ...mcp.args].join(" ")}
                      {Object.keys(mcp.env).length > 0 && ` · ${Object.keys(mcp.env).join(", ")}`}
                    </p>
                  ) : (
                    <Badge variant="outline" className="text-muted-foreground">
                      {t("mcps.noCommand")}
                    </Badge>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={mcp.enabled}
                    onCheckedChange={(checked) => toggle(mcp.id, checked, mcp.name)}
                    aria-label={t("mcps.aria.enable", { name: mcp.name })}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("mcps.aria.edit", { name: mcp.name })}
                    onClick={() => setEditing(mcp)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t("mcps.aria.remove", { name: mcp.name })}
                    onClick={() => remove.mutate(mcp.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {open && (
        <McpDialog
          open
          onOpenChange={setOpen}
          initial={BLANK}
          title={t("mcps.dialog.title")}
          description={t("mcps.dialog.description")}
          submitLabel={t("common.add")}
          pending={create.isPending}
          onSubmit={submitCreate}
        />
      )}
      {editing && (
        // Keyed so the form resets when a different server is opened.
        <McpDialog
          key={editing.id}
          open
          onOpenChange={(next) => !next && setEditing(null)}
          initial={draftFrom(editing)}
          title={t("mcps.dialog.editTitle")}
          description={t("mcps.dialog.editDescription")}
          submitLabel={t("common.save")}
          pending={update.isPending}
          onSubmit={(draft) => submitEdit(editing, draft)}
        />
      )}
    </div>
  );
}
