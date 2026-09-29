"use client";

import { BookOpen, Play, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { StoredWorkflowTemplate } from "@/lib/schema";
import { isBuiltinTemplateId } from "@/lib/templates/catalog";

export function TemplateCard({
  template,
  onLearnMore,
  onUse,
  onSaveCopy,
  labels,
}: {
  template: StoredWorkflowTemplate;
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
    <Card className="flex flex-col">
      <CardHeader className="space-y-2 pb-2">
        <div className="flex items-start justify-between gap-2">
          <span className="text-2xl" aria-hidden>
            {template.icon}
          </span>
          <Badge variant={builtin ? "default" : "secondary"}>
            {builtin ? labels.starter : labels.custom}
          </Badge>
        </div>
        <h2 className="text-lg font-semibold leading-tight">{template.name}</h2>
        <p className="text-sm text-muted-foreground">{template.summary || template.description}</p>
      </CardHeader>
      <CardContent className="flex-1 text-xs text-muted-foreground">
        {template.agents.length > 0 && (
          <p>
            {labels.agents}: {template.agents.map((agent) => agent.name).join(" · ")}
          </p>
        )}
      </CardContent>
      <div className="flex flex-wrap gap-2 border-t border-border px-5 py-4">
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
