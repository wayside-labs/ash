"use client";

import { GitBranch, Network, Sparkles } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import type { AIGraphBlueprint } from "@/components/flow/types";
import { Button } from "@/components/ui/button";
import { useWorkflows } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { deliverCanvasBlueprint, isActiveCanvasRoute } from "@/lib/canvas-blueprint-bridge";
import type { DraftCanvasBlueprintInput } from "@/lib/chat-stream";
import { cn } from "@/lib/utils";

type CanvasBlueprintCardProps = {
  input: DraftCanvasBlueprintInput;
  className?: string;
};

export function CanvasBlueprintCard({ input, className }: CanvasBlueprintCardProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { workflows } = useWorkflows({ withChain: false });
  const [appliedInPlace, setAppliedInPlace] = useState(false);

  const workflow = workflows.find((row) => row.id === input.workflowId);
  const onActiveCanvas = isActiveCanvasRoute(pathname, input.workflowId);
  const nodeCount = input.nodes.length;
  const edgeCount = input.edges.length;

  const visualize = () => {
    const mode = deliverCanvasBlueprint(
      {
        workflowId: input.workflowId,
        title: input.title,
        nodes: input.nodes as AIGraphBlueprint["nodes"],
        edges: input.edges as AIGraphBlueprint["edges"],
        autoMagicFix: true,
      },
      { pathname, navigate: (href) => router.push(href) },
    );

    if (mode === "in-place") {
      setAppliedInPlace(true);
      if (typeof window !== "undefined") {
        window.setTimeout(() => setAppliedInPlace(false), 2400);
      }
    }
  };

  return (
    <div className={cn("surface-card mt-3 overflow-hidden rounded-xl", className)}>
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
            <GitBranch className="h-4 w-4 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-accent">
              {t("chat.blueprint.kicker")}
            </p>
            <h3 className="mt-0.5 truncate text-sm font-semibold text-foreground">{input.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {workflow
                ? t("chat.blueprint.workflowTarget", { name: workflow.name })
                : t("chat.blueprint.workflowMissing")}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-border bg-border">
        <div className="surface-sunken px-4 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("chat.blueprint.nodes")}
          </p>
          <p className="num mt-0.5 text-lg font-semibold tabular-nums text-accent">{nodeCount}</p>
        </div>
        <div className="surface-sunken px-4 py-2.5">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("chat.blueprint.edges")}
          </p>
          <p className="num mt-0.5 text-lg font-semibold tabular-nums text-accent">{edgeCount}</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="text-xs text-muted-foreground">
          {onActiveCanvas ? t("chat.blueprint.hintLive") : t("chat.blueprint.hint")}
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={visualize}
          disabled={!workflow || appliedInPlace}
          className="border border-accent/20 text-accent hover:bg-accent/10"
        >
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          {appliedInPlace ? t("chat.blueprint.applied") : t("chat.blueprint.visualize")}
          {!appliedInPlace ? <Network className="h-3.5 w-3.5 opacity-80" /> : null}
        </Button>
      </div>
    </div>
  );
}
