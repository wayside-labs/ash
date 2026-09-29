"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useApplyTemplate, useCreateResource } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { addressSchema, type StoredWorkflowTemplate } from "@/lib/schema";
import { useAppStore } from "@/stores/app-store";

function isMalformedAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !addressSchema.safeParse(trimmed).success;
}

export function TemplateDetailDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: StoredWorkflowTemplate | null;
}) {
  const { t } = useTranslation();
  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            <span className="mr-2" aria-hidden>
              {template.icon}
            </span>
            {template.name}
          </DialogTitle>
          <DialogDescription>{template.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          <section>
            <h3 className="mb-1 font-medium">{t("templates.howItWorks")}</h3>
            <p className="whitespace-pre-wrap text-muted-foreground">{template.howItWorks}</p>
          </section>
          {template.setupSteps.length > 0 && (
            <section>
              <h3 className="mb-2 font-medium">{t("templates.setupChecklist")}</h3>
              <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                {template.setupSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          )}
          {template.docsPath && (
            <p className="text-xs text-faint-foreground">
              {t("templates.docsHint", { path: template.docsPath })}
            </p>
          )}
        </div>
        <div className="flex justify-end pt-2">
          <Button type="button" variant="secondary" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function UseTemplateDialog({
  open,
  onOpenChange,
  template,
  onApplied,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: StoredWorkflowTemplate | null;
  onApplied: (workflowId: string) => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const apply = useApplyTemplate();
  const { cluster, walletAddress } = useAppStore();
  const [workflowName, setWorkflowName] = useState("");
  const [treasuryAddress, setTreasuryAddress] = useState("");

  useEffect(() => {
    if (open && template) {
      setWorkflowName(template.name);
      setTreasuryAddress("");
    }
  }, [open, template]);

  if (!template) return null;

  const treasuryInvalid = isMalformedAddress(treasuryAddress);

  const submit = async () => {
    if (!workflowName.trim() || treasuryInvalid) return;
    try {
      const result = await apply.mutateAsync({
        templateId: template.id,
        workflowName: workflowName.trim(),
        cluster,
        ownerAddress: walletAddress,
        treasuryAddress: treasuryAddress.trim() || null,
      });
      onOpenChange(false);
      toast(t("templates.use.created", { name: workflowName.trim() }));
      const next = result.setupSteps[0];
      if (next) toast(next);
      onApplied(result.workflowId);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("templates.use.failed"), "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("templates.use.title")}</DialogTitle>
          <DialogDescription>{t("templates.use.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="tpl-wf-name">{t("common.name")}</Label>
            <Input
              id="tpl-wf-name"
              value={workflowName}
              onChange={(e) => setWorkflowName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="tpl-treasury">
              {t("workflowDialogs.createWorkflow.treasuryLabel")}
            </Label>
            <Input
              id="tpl-treasury"
              value={treasuryAddress}
              onChange={(e) => setTreasuryAddress(e.target.value)}
              placeholder={t("workflowDialogs.createWorkflow.treasuryPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("workflowDialogs.createWorkflow.treasuryHint")}
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2 pt-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" asChild>
            <Link href="/treasury">{t("templates.use.openTreasury")}</Link>
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!workflowName.trim() || treasuryInvalid || apply.isPending}
          >
            {apply.isPending ? t("common.creating") : t("templates.use.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CreateTemplateDialog({
  open,
  onOpenChange,
  initial,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: StoredWorkflowTemplate | null;
}) {
  const { t } = useTranslation();
  const create = useCreateResource("templates");
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState("📋");
  const [summary, setSummary] = useState("");
  const [howItWorks, setHowItWorks] = useState("");
  const [setupStepsText, setSetupStepsText] = useState("");

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(`${initial.name} (copy)`);
      setDescription(initial.description);
      setIcon(initial.icon);
      setSummary(initial.summary);
      setHowItWorks(initial.howItWorks);
      setSetupStepsText(initial.setupSteps.join("\n"));
    } else {
      setName("");
      setDescription("");
      setIcon("📋");
      setSummary("");
      setHowItWorks("");
      setSetupStepsText("");
    }
  }, [open, initial]);

  const submit = async () => {
    if (!name.trim()) return;
    const setupSteps = setupStepsText
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        icon,
        summary: summary.trim(),
        howItWorks: howItWorks.trim(),
        setupSteps,
        agents: initial?.agents ?? [],
        docsPath: null,
      });
      toast(t("templates.create.created", { name: name.trim() }));
      onOpenChange(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("templates.create.failed"), "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("templates.create.title")}</DialogTitle>
          <DialogDescription>{t("templates.create.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-[auto_1fr]">
            <div className="space-y-2">
              <Label htmlFor="ct-icon">{t("common.icon")}</Label>
              <Input
                id="ct-icon"
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                className="w-16 text-center"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ct-name">{t("common.name")}</Label>
              <Input id="ct-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-desc">{t("common.description")}</Label>
            <Textarea
              id="ct-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-summary">{t("templates.create.summary")}</Label>
            <Input id="ct-summary" value={summary} onChange={(e) => setSummary(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-how">{t("templates.howItWorks")}</Label>
            <Textarea
              id="ct-how"
              value={howItWorks}
              onChange={(e) => setHowItWorks(e.target.value)}
              rows={4}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ct-steps">{t("templates.create.setupSteps")}</Label>
            <Textarea
              id="ct-steps"
              value={setupStepsText}
              onChange={(e) => setSetupStepsText(e.target.value)}
              placeholder={t("templates.create.setupStepsPlaceholder")}
              rows={5}
            />
          </div>
        </div>
        <div className="flex justify-end pt-2">
          <Button type="button" onClick={submit} disabled={!name.trim() || create.isPending}>
            {create.isPending ? t("common.creating") : t("common.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
