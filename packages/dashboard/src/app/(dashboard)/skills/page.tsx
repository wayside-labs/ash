"use client";

import { Brain, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import {
  useCreateResource,
  useDashboardState,
  useDeleteResource,
  useUpdateResource,
} from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import type { Scope, Skill } from "@/lib/types";

interface SkillDraft {
  name: string;
  description: string;
  icon: string;
  content: string;
  scope: Scope;
}

const BLANK: SkillDraft = {
  name: "",
  description: "",
  icon: "🧩",
  content: "",
  scope: "global",
};

/**
 * One form for create and edit. The skill's `content` is the payload — the
 * name and description are just how it is found in this list.
 */
function SkillDialog({
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
  initial: SkillDraft;
  title: string;
  description: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (draft: SkillDraft) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(initial);
  const set = <K extends keyof SkillDraft>(key: K, value: SkillDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="space-y-2">
              <Label htmlFor="sk-icon">{t("common.icon")}</Label>
              <Input
                id="sk-icon"
                value={draft.icon}
                onChange={(e) => set("icon", e.target.value)}
                className="w-16 text-center"
                maxLength={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sk-name">{t("common.name")}</Label>
              <Input
                id="sk-name"
                value={draft.name}
                onChange={(e) => set("name", e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sk-desc">{t("common.description")}</Label>
            <Input
              id="sk-desc"
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="sk-content">{t("skills.content")}</Label>
            <Textarea
              id="sk-content"
              value={draft.content}
              onChange={(e) => set("content", e.target.value)}
              placeholder={t("skills.contentPlaceholder")}
              spellCheck={false}
              className="min-h-[220px] font-mono text-xs leading-relaxed"
            />
            <p className="text-xs text-muted-foreground">{t("skills.contentHint")}</p>
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
          <Button onClick={() => onSubmit(draft)} disabled={!draft.name.trim() || pending}>
            {submitLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function SkillsPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useDashboardState();
  const update = useUpdateResource("skills");
  const remove = useDeleteResource("skills");
  const create = useCreateResource("skills");
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Skill | null>(null);

  const skills = data?.skills ?? [];

  const toggle = async (skill: Skill, enabled: boolean) => {
    try {
      await update.mutateAsync({ id: skill.id, enabled });
      toast(
        enabled
          ? t("common.itemEnabled", { name: skill.name })
          : t("common.itemDisabled", { name: skill.name }),
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToSave"), "error");
    }
  };

  const submitCreate = async (draft: SkillDraft) => {
    try {
      await create.mutateAsync({
        name: draft.name.trim(),
        description: draft.description.trim(),
        icon: draft.icon,
        content: draft.content,
        scope: draft.scope,
        enabled: true,
        demo: false,
      });
      toast(t("skills.created", { name: draft.name.trim() }));
      setOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToCreate"), "error");
    }
  };

  const submitEdit = async (skill: Skill, draft: SkillDraft) => {
    try {
      await update.mutateAsync({
        id: skill.id,
        name: draft.name.trim(),
        description: draft.description.trim(),
        icon: draft.icon,
        content: draft.content,
        scope: draft.scope,
      });
      toast(t("skills.updated", { name: draft.name.trim() }));
      setEditing(null);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToSave"), "error");
    }
  };

  const SkillList = ({ items }: { items: Skill[] }) =>
    items.length === 0 ? (
      <p className="py-8 text-center text-sm text-muted-foreground">
        {t("skills.noSkillsInScope")}
      </p>
    ) : (
      <div className="grid gap-3">
        {items.map((skill) => (
          <Card key={skill.id}>
            <CardContent className="flex items-center justify-between gap-4 p-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="text-xl">{skill.icon}</span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{skill.name}</p>
                    {skill.demo && <DemoBadge />}
                    {!skill.content.trim() && (
                      <Badge variant="outline" className="text-muted-foreground">
                        {t("skills.noContent")}
                      </Badge>
                    )}
                  </div>
                  <p className="truncate text-sm text-muted-foreground">{skill.description}</p>
                  {skill.scopeName && (
                    <Badge variant="outline" className="mt-1">
                      {skill.scopeName}
                    </Badge>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Switch
                  checked={skill.enabled}
                  onCheckedChange={(checked) => toggle(skill, checked)}
                  aria-label={t("skills.aria.enable", { name: skill.name })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("skills.aria.edit", { name: skill.name })}
                  onClick={() => setEditing(skill)}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("skills.aria.remove", { name: skill.name })}
                  onClick={() => remove.mutate(skill.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );

  return (
    <div>
      <PageHeader
        title={t("skills.title")}
        description={t("skills.description")}
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            {t("skills.newSkill")}
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : skills.length === 0 ? (
        <EmptyState
          icon={Brain}
          title={t("skills.emptyTitle")}
          description={t("skills.emptyDescription")}
          action={{ label: t("skills.createSkill"), onClick: () => setOpen(true) }}
        />
      ) : (
        <Tabs defaultValue="global">
          <TabsList>
            <TabsTrigger value="global">{t("common.global")}</TabsTrigger>
            <TabsTrigger value="workflow">{t("common.byWorkflow")}</TabsTrigger>
            <TabsTrigger value="agent">{t("common.byAgent")}</TabsTrigger>
          </TabsList>
          <TabsContent value="global">
            <SkillList items={skills.filter((s) => s.scope === "global")} />
          </TabsContent>
          <TabsContent value="workflow">
            <SkillList items={skills.filter((s) => s.scope === "workflow")} />
          </TabsContent>
          <TabsContent value="agent">
            <SkillList items={skills.filter((s) => s.scope === "agent")} />
          </TabsContent>
        </Tabs>
      )}

      {open && (
        <SkillDialog
          open
          onOpenChange={setOpen}
          initial={BLANK}
          title={t("skills.dialog.title")}
          description={t("skills.dialog.description")}
          submitLabel={t("common.create")}
          pending={create.isPending}
          onSubmit={submitCreate}
        />
      )}
      {editing && (
        // Keyed so the form state resets when a different skill is opened.
        <SkillDialog
          key={editing.id}
          open
          onOpenChange={(next) => !next && setEditing(null)}
          initial={{
            name: editing.name,
            description: editing.description,
            icon: editing.icon,
            content: editing.content,
            scope: editing.scope,
          }}
          title={t("skills.dialog.editTitle")}
          description={t("skills.dialog.editDescription")}
          submitLabel={t("common.save")}
          pending={update.isPending}
          onSubmit={(draft) => submitEdit(editing, draft)}
        />
      )}
    </div>
  );
}
