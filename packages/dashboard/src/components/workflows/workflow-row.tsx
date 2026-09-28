"use client";

import { ChevronLeft, ChevronRight, Download, Network, Pencil, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AgentCard } from "@/components/workflows/agent-card";
import { AgentSettingsSheet } from "@/components/workflows/agent-settings-sheet";
import { EditWorkflowDialog } from "@/components/workflows/workflow-dialogs";
import { useDeleteResource, useExportRunnerConfig } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { runnerConfigFilename } from "@/lib/mcp-config";
import type { Agent, Workflow } from "@/lib/types";
import { cn, formatMoney, moneyTone } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";

interface WorkflowRowProps {
  workflow: Workflow;
  onAddAgent?: (workflowId: string) => void;
}

export function WorkflowRow({ workflow, onAddAgent }: WorkflowRowProps) {
  const { t } = useTranslation();
  const hidden = useBalancesHidden();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const remove = useDeleteResource("workflows");
  const exportConfig = useExportRunnerConfig();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  useEffect(() => {
    updateScrollButtons();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateScrollButtons);
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateScrollButtons]);

  const scroll = (direction: "left" | "right") => {
    scrollRef.current?.scrollBy({
      left: direction === "left" ? -220 : 220,
      behavior: "smooth",
    });
  };

  /**
   * Compiles this workflow's enabled MCPs into the `.mcp.json` an agent runner
   * reads. Anything enabled but without a command cannot be spawned, so the
   * toast names how many were left out rather than failing silently.
   */
  const handleExport = async () => {
    try {
      const { servers, skipped } = await exportConfig.mutateAsync({ workflow });
      if (servers === 0) {
        toast(t("workflowRow.exportedNothing"), "error");
        return;
      }
      const skippedNote =
        skipped > 0 ? ` ${t("workflowRow.exportedSkipped", { count: skipped })}` : "";
      toast(
        t("workflowRow.exported", {
          count: servers,
          file: runnerConfigFilename(workflow.name),
        }) + skippedNote,
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToExport"), "error");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(t("workflowRow.confirmRemove", { name: workflow.name }))) {
      return;
    }
    try {
      await remove.mutateAsync(workflow.id);
      toast(t("workflowRow.removed", { name: workflow.name }));
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToRemove"), "error");
    }
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-2xl">{workflow.icon}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{workflow.name}</h2>
              {workflow.demo && <DemoBadge />}
            </div>
            <p className="truncate text-sm text-muted-foreground">
              {workflow.description} · {t("common.vaultLabel")}{" "}
              <span className={`num ${moneyTone(workflow.balance)}`}>
                {formatMoney(workflow.balance, hidden)}
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/workflows/${workflow.id}/canvas`}>
              <Network className="h-3.5 w-3.5" />
              {t("workflowRow.openCanvas")}
            </Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => onAddAgent?.(workflow.id)}>
            <Plus className="h-3.5 w-3.5" />
            {t("workflowRow.addAgent")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            aria-label={t("workflowRow.aria.exportConfig", { name: workflow.name })}
            onClick={handleExport}
            disabled={exportConfig.isPending}
          >
            <Download className="h-3.5 w-3.5" />
            {t("workflowRow.exportConfig")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("workflowRow.aria.editWorkflow", { name: workflow.name })}
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("workflowRow.aria.removeWorkflow")}
            onClick={handleDelete}
            disabled={remove.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {workflow.agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          {t("workflowRow.noAgents")}
        </div>
      ) : (
        <div className="group relative">
          {canScrollLeft && (
            <Button
              variant="secondary"
              size="icon"
              aria-label={t("workflowRow.aria.scrollLeft")}
              className="absolute left-0 top-1/2 z-10 h-8 w-8 -translate-y-1/2 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
              onClick={() => scroll("left")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          )}

          <div
            ref={scrollRef}
            onScroll={updateScrollButtons}
            className={cn("flex gap-3 overflow-x-auto pb-2 scrollbar-hide")}
          >
            {workflow.agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onClick={() => setEditingAgent(agent)} />
            ))}
          </div>

          {canScrollRight && (
            <Button
              variant="secondary"
              size="icon"
              aria-label={t("workflowRow.aria.scrollRight")}
              className="absolute right-0 top-1/2 z-10 h-8 w-8 -translate-y-1/2 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
              onClick={() => scroll("right")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {editing && (
        <EditWorkflowDialog
          key={workflow.id}
          workflow={workflow}
          open
          onOpenChange={(open) => !open && setEditing(false)}
        />
      )}
      {editingAgent && (
        <AgentSettingsSheet
          key={editingAgent.id}
          agent={editingAgent}
          workflow={workflow}
          open
          onOpenChange={(open) => !open && setEditingAgent(null)}
        />
      )}
    </section>
  );
}
