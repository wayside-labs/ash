"use client";

import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AgentCard } from "@/components/workflows/agent-card";
import { useDeleteResource } from "@/hooks/use-dashboard";
import type { Workflow } from "@/lib/types";
import { cn, formatMoney, moneyTone } from "@/lib/utils";

interface WorkflowRowProps {
  workflow: Workflow;
  onAddAgent?: (workflowId: string) => void;
}

export function WorkflowRow({ workflow, onAddAgent }: WorkflowRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const remove = useDeleteResource("workflows");
  const toast = useToast();

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  // The original only recomputed after a click, so the right arrow showed on an
  // unscrollable row and stayed hidden after the list changed.
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

  const handleDelete = async () => {
    if (!window.confirm(`Remover o workflow "${workflow.name}" e seus agentes do dashboard?`)) {
      return;
    }
    try {
      await remove.mutateAsync(workflow.id);
      toast(`Workflow "${workflow.name}" removido.`);
    } catch (error) {
      toast(error instanceof Error ? error.message : "Falha ao remover", "error");
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
              {workflow.description} · Cofre:{" "}
              <span className={`num ${moneyTone(workflow.balance)}`}>
                {formatMoney(workflow.balance)}
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" size="sm" onClick={() => onAddAgent?.(workflow.id)}>
            <Plus className="h-3.5 w-3.5" />
            Agente
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Remover workflow"
            onClick={handleDelete}
            disabled={remove.isPending}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {workflow.agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          Nenhum agente neste workflow ainda.
        </div>
      ) : (
        <div className="group relative">
          {canScrollLeft && (
            <Button
              variant="secondary"
              size="icon"
              aria-label="Rolar para a esquerda"
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
              <AgentCard key={agent.id} agent={agent} />
            ))}
          </div>

          {canScrollRight && (
            <Button
              variant="secondary"
              size="icon"
              aria-label="Rolar para a direita"
              className="absolute right-0 top-1/2 z-10 h-8 w-8 -translate-y-1/2 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
              onClick={() => scroll("right")}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
