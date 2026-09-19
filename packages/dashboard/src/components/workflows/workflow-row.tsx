"use client";

import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { AgentCard } from "@/components/workflows/agent-card";
import type { Workflow } from "@/lib/types";
import { formatUsd } from "@/lib/utils";

interface WorkflowRowProps {
  workflow: Workflow;
}

export function WorkflowRow({ workflow }: WorkflowRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const updateScrollButtons = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 0);
    setCanScrollRight(el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
  }, []);

  const scroll = (direction: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = 220;
    el.scrollBy({ left: direction === "left" ? -amount : amount, behavior: "smooth" });
    setTimeout(updateScrollButtons, 300);
  };

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-2xl">{workflow.icon}</span>
          <div>
            <h2 className="text-lg font-semibold">{workflow.name}</h2>
            <p className="text-sm text-muted-foreground">
              {workflow.description} · Cofre: {formatUsd(workflow.treasuryBalanceUsd)}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm">
          <Plus className="h-3.5 w-3.5" />
          Agente
        </Button>
      </div>

      <div className="group relative">
        {canScrollLeft && (
          <Button
            variant="secondary"
            size="icon"
            className="absolute left-0 top-1/2 z-10 h-8 w-8 -translate-y-1/2 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
            onClick={() => scroll("left")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
        )}

        <div
          ref={scrollRef}
          onScroll={updateScrollButtons}
          className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide"
        >
          {workflow.agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>

        {canScrollRight && workflow.agents.length > 3 && (
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-0 top-1/2 z-10 h-8 w-8 -translate-y-1/2 opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
            onClick={() => scroll("right")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
    </section>
  );
}
