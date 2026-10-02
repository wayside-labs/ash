"use client";

import { BookOpen, Play, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { StoredWorkflowTemplate } from "@/lib/schema";
import { isBuiltinTemplateId } from "@/lib/templates/catalog";

export function TemplateCard({
  template,
  onOpen,
  onLearnMore,
  onUse,
  onSaveCopy,
  labels,
}: {
  template: StoredWorkflowTemplate;
  /** Open this template in the builder. */
  onOpen: () => void;
  onLearnMore: () => void;
  onUse: () => void;
  onSaveCopy?: () => void;
  labels: {
    starter: string;
    custom: string;
    learnMore: string;
    use: string;
    saveCopy: string;
    agents: string;
  };
}) {
  const builtin = isBuiltinTemplateId(template.id);
  return (
    <Card
      data-testid="template-card"
      className="relative flex flex-col transition-colors hover:border-primary/40"
    >
      <CardHeader className="space-y-2 pb-2">
        <div className="flex items-start justify-between gap-2">
          <span className="text-2xl" aria-hidden>
            {template.icon}
          </span>
          <Badge variant={builtin ? "default" : "secondary"}>
            {builtin ? labels.starter : labels.custom}
          </Badge>
        </div>
        {/* The title is the card's button: its ::after stretches over the card so the whole
            card opens the builder, while the footer buttons below stay separately clickable. */}
        <h2 className="text-lg font-semibold leading-tight">
          <button
            type="button"
            onClick={onOpen}
            className="text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-primary/50"
          >
            {template.name}
          </button>
        </h2>
        <p className="text-sm text-muted-foreground">{template.summary || template.description}</p>
      </CardHeader>
      <CardContent className="flex-1 text-xs text-muted-foreground">
        {template.agents.length > 0 && (
          <p>
            {labels.agents}: {template.agents.map((agent) => agent.name).join(" · ")}
          </p>
        )}
      </CardContent>
      <div className="relative z-10 flex flex-wrap gap-2 border-t border-border px-5 py-4">
        <Button type="button" variant="outline" size="sm" onClick={onLearnMore}>
          <BookOpen className="h-3.5 w-3.5" />
          {labels.learnMore}
        </Button>
        <Button type="button" size="sm" onClick={onUse}>
          <Play className="h-3.5 w-3.5" />
          {labels.use}
        </Button>
        {builtin && onSaveCopy && (
          <Button type="button" variant="ghost" size="sm" onClick={onSaveCopy}>
            <Sparkles className="h-3.5 w-3.5" />
            {labels.saveCopy}
          </Button>
        )}
      </div>
    </Card>
  );
}
