"use client";

import { useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useCreateResource, useUpdateResource } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { addressSchema } from "@/lib/schema";
import type { Agent, Workflow } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

const ICONS = ["🏪", "📈", "🏭", "🤖", "🛰️", "🧪", "🚚", "💼"];

/**
 * An empty field means "not provisioned" and is always allowed; anything else
 * has to look like base58 before it can be saved, because the stored value is
 * handed straight to the RPC as a getBalance/getAccountInfo argument.
 */
function isMalformedAddress(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && !addressSchema.safeParse(trimmed).success;
}

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {ICONS.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={`flex h-9 w-9 items-center justify-center rounded-lg border text-lg transition-colors ${
            value === option
              ? "border-primary bg-primary/10"
              : "border-border hover:border-primary/40"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

export function CreateWorkflowDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const create = useCreateResource("workflows");
  const toast = useToast();
  const { cluster, walletAddress } = useAppStore();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [icon, setIcon] = useState(ICONS[0] ?? "⚡");
  const [treasuryAddress, setTreasuryAddress] = useState("");

  const treasuryInvalid = isMalformedAddress(treasuryAddress);

  const submit = async () => {
    if (!name.trim() || treasuryInvalid) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        description: description.trim(),
        icon,
        cluster,
        ownerAddress: walletAddress,
        treasuryAddress: treasuryAddress.trim() || null,
        demo: false,
        demoBalanceUsd: null,
      });
      toast(t("workflowDialogs.createWorkflow.created", { name: name.trim() }));
      setName("");
      setDescription("");
      setTreasuryAddress("");
      onOpenChange(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToCreateWorkflow"), "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("workflowDialogs.createWorkflow.title")}</DialogTitle>
          <DialogDescription>{t("workflowDialogs.createWorkflow.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wf-name">{t("common.name")}</Label>
            <Input
              id="wf-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("workflowDialogs.createWorkflow.namePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wf-desc">{t("common.description")}</Label>
            <Textarea
              id="wf-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("workflowDialogs.createWorkflow.descriptionPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("common.icon")}</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wf-treasury">{t("workflowDialogs.createWorkflow.treasuryLabel")}</Label>
            <Input
              id="wf-treasury"
              value={treasuryAddress}
              onChange={(e) => setTreasuryAddress(e.target.value)}
              placeholder={t("workflowDialogs.createWorkflow.treasuryPlaceholder")}
              className="num text-sm"
              aria-invalid={treasuryInvalid}
            />
            <p
              className={`text-xs ${treasuryInvalid ? "text-destructive" : "text-muted-foreground"}`}
            >
              {treasuryInvalid
                ? t("common.invalidAddress")
                : t("workflowDialogs.createWorkflow.treasuryHint")}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!name.trim() || treasuryInvalid || create.isPending}>
            {create.isPending ? t("common.creating") : t("workflowDialogs.createWorkflow.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CreateAgentDialog({
  open,
  onOpenChange,
  workflows,
  defaultWorkflowId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workflows: Workflow[];
  defaultWorkflowId?: string;
}) {
  const { t } = useTranslation();
  const create = useCreateResource("agents");
  const toast = useToast();
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [workflowId, setWorkflowId] = useState(defaultWorkflowId ?? workflows[0]?.id ?? "");
  const [dailyLimitUsd, setDailyLimitUsd] = useState("50");
  const [walletAddress, setWalletAddress] = useState("");

  const walletInvalid = isMalformedAddress(walletAddress);
  const limit = Number(dailyLimitUsd);
  const limitInvalid = !Number.isFinite(limit) || limit < 0;

  const submit = async () => {
    if (!name.trim() || !workflowId || walletInvalid || limitInvalid) return;
    try {
      await create.mutateAsync({
        name: name.trim(),
        role: role.trim(),
        workflowId,
        walletAddress: walletAddress.trim() || null,
        dailyLimitUsd: limit,
        paysTo: [],
        receivesFrom: workflows.find((w) => w.id === workflowId)?.name ?? "",
        status: "active",
        demo: false,
        demoBalanceUsd: null,
        demoSpentUsd: null,
      });
      toast(t("workflowDialogs.createAgent.created", { name: name.trim() }));
      setName("");
      setRole("");
      setWalletAddress("");
      onOpenChange(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToCreateAgent"), "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("workflowDialogs.createAgent.title")}</DialogTitle>
          <DialogDescription>{t("workflowDialogs.createAgent.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ag-name">{t("common.name")}</Label>
              <Input
                id="ag-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("workflowDialogs.createAgent.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-role">{t("workflowDialogs.createAgent.roleLabel")}</Label>
              <Input
                id="ag-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder={t("workflowDialogs.createAgent.rolePlaceholder")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("common.workflow")}</Label>
            <Select value={workflowId} onValueChange={setWorkflowId}>
              <SelectTrigger>
                <SelectValue placeholder={t("workflowDialogs.createAgent.workflowPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {workflows.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.icon} {workflow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ag-limit">{t("workflowDialogs.createAgent.dailyLimitLabel")}</Label>
              <Input
                id="ag-limit"
                type="number"
                min={0}
                value={dailyLimitUsd}
                onChange={(e) => setDailyLimitUsd(e.target.value)}
                aria-invalid={limitInvalid}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-wallet">{t("workflowDialogs.createAgent.walletLabel")}</Label>
              <Input
                id="ag-wallet"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder={t("workflowDialogs.createAgent.walletPlaceholder")}
                className="num text-sm"
                aria-invalid={walletInvalid}
              />
              {walletInvalid && (
                <p className="text-xs text-destructive">{t("common.invalidAddress")}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={
              !name.trim() || !workflowId || walletInvalid || limitInvalid || create.isPending
            }
          >
            {create.isPending ? t("common.creating") : t("workflowDialogs.createAgent.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Edit dialogs are mounted keyed by row id and unmounted on close, so every
 * field initialises from the row it is editing — no effect syncing props into
 * state, and no stale value left over from the previously edited row.
 */
export function EditWorkflowDialog({
  workflow,
  open,
  onOpenChange,
}: {
  workflow: Workflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateResource("workflows");
  const toast = useToast();
  const [name, setName] = useState(workflow.name);
  const [description, setDescription] = useState(workflow.description);
  const [icon, setIcon] = useState(workflow.icon);
  const [treasuryAddress, setTreasuryAddress] = useState(workflow.treasuryAddress ?? "");

  const treasuryInvalid = isMalformedAddress(treasuryAddress);

  const submit = async () => {
    if (!name.trim() || treasuryInvalid) return;
    try {
      await update.mutateAsync({
        id: workflow.id,
        name: name.trim(),
        description: description.trim(),
        icon,
        treasuryAddress: treasuryAddress.trim() || null,
      });
      toast(t("workflowDialogs.editWorkflow.updated", { name: name.trim() }));
      onOpenChange(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToUpdate"), "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("workflowDialogs.editWorkflow.title")}</DialogTitle>
          <DialogDescription>{t("workflowDialogs.editWorkflow.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="wf-edit-name">{t("common.name")}</Label>
            <Input
              id="wf-edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("workflowDialogs.createWorkflow.namePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wf-edit-desc">{t("common.description")}</Label>
            <Textarea
              id="wf-edit-desc"
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("workflowDialogs.createWorkflow.descriptionPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("common.icon")}</Label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="wf-edit-treasury">
              {t("workflowDialogs.createWorkflow.treasuryLabel")}
            </Label>
            <Input
              id="wf-edit-treasury"
              value={treasuryAddress}
              onChange={(e) => setTreasuryAddress(e.target.value)}
              placeholder={t("workflowDialogs.createWorkflow.treasuryPlaceholder")}
              className="num text-sm"
              aria-invalid={treasuryInvalid}
            />
            <p
              className={`text-xs ${treasuryInvalid ? "text-destructive" : "text-muted-foreground"}`}
            >
              {treasuryInvalid
                ? t("common.invalidAddress")
                : t("workflowDialogs.editWorkflow.treasuryHint")}
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={!name.trim() || treasuryInvalid || update.isPending}>
            {update.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function EditAgentDialog({
  agent,
  open,
  onOpenChange,
}: {
  agent: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateResource("agents");
  const toast = useToast();
  const [name, setName] = useState(agent.name);
  const [role, setRole] = useState(agent.role);
  const [dailyLimitUsd, setDailyLimitUsd] = useState(String(agent.dailyLimitUsd));
  const [walletAddress, setWalletAddress] = useState(agent.walletAddress ?? "");

  const walletInvalid = isMalformedAddress(walletAddress);
  const limit = Number(dailyLimitUsd);
  const limitInvalid = !Number.isFinite(limit) || limit < 0;

  const submit = async () => {
    if (!name.trim() || walletInvalid || limitInvalid) return;
    try {
      await update.mutateAsync({
        id: agent.id,
        name: name.trim(),
        role: role.trim(),
        dailyLimitUsd: limit,
        walletAddress: walletAddress.trim() || null,
      });
      toast(t("workflowDialogs.editAgent.updated", { name: name.trim() }));
      onOpenChange(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToUpdate"), "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("workflowDialogs.editAgent.title")}</DialogTitle>
          <DialogDescription>{t("workflowDialogs.editAgent.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ag-edit-name">{t("common.name")}</Label>
              <Input
                id="ag-edit-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("workflowDialogs.createAgent.namePlaceholder")}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-edit-role">{t("workflowDialogs.createAgent.roleLabel")}</Label>
              <Input
                id="ag-edit-role"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                placeholder={t("workflowDialogs.createAgent.rolePlaceholder")}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("common.workflow")}</Label>
            <p className="rounded-lg border border-border bg-elevated/40 px-3 py-2 text-sm text-muted-foreground">
              {agent.workflowName}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="ag-edit-limit">
                {t("workflowDialogs.createAgent.dailyLimitLabel")}
              </Label>
              <Input
                id="ag-edit-limit"
                type="number"
                min={0}
                value={dailyLimitUsd}
                onChange={(e) => setDailyLimitUsd(e.target.value)}
                aria-invalid={limitInvalid}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="ag-edit-wallet">{t("workflowDialogs.createAgent.walletLabel")}</Label>
              <Input
                id="ag-edit-wallet"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                placeholder={t("workflowDialogs.createAgent.walletPlaceholder")}
                className="num text-sm"
                aria-invalid={walletInvalid}
              />
              {walletInvalid && (
                <p className="text-xs text-destructive">{t("common.invalidAddress")}</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            onClick={submit}
            disabled={!name.trim() || walletInvalid || limitInvalid || update.isPending}
          >
            {update.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
