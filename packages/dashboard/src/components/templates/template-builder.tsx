"use client";

import { BookOpen, Play, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/locale-provider";
import type { StoredWorkflowTemplate } from "@/lib/schema";
import { isBuiltinTemplateId } from "@/lib/templates/catalog";

// React Flow measures the DOM, so it renders on the client only, like the workflow canvas.
const TemplateCanvas = dynamic(
  () =>
    import("@/components/templates/template-canvas").then((m) => ({ default: m.TemplateCanvas })),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">…</div>
    ),
  },
);

/**
 * The builder half of the templates workspace: what the selected template becomes on a
 * canvas, with the three things you can do about it. The picture is a read-only preview —
 * Use creates real rows, and the live canvas is where they are edited.
 */
export function TemplateBuilder({
  template,
  onLearnMore,
  onUse,
  onSaveCopy,
}: {
  template: StoredWorkflowTemplate;
  onLearnMore: () => void;
  onUse: () => void;
  onSaveCopy: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="template-builder">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/40 px-4 py-2.5 backdrop-blur-sm">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-medium" data-testid="template-builder-title">
            <span aria-hidden>{template.icon}</span> {template.name}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {template.summary || template.description}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onLearnMore}>
            <BookOpen className="h-3.5 w-3.5" />
            {t("templates.learnMore")}
          </Button>
          {isBuiltinTemplateId(template.id) && (
            <Button type="button" variant="ghost" size="sm" onClick={onSaveCopy}>
              <Sparkles className="h-3.5 w-3.5" />
              {t("templates.saveCopy")}
            </Button>
          )}
          <Button type="button" size="sm" onClick={onUse}>
            <Play className="h-3.5 w-3.5" />
            {t("templates.use.submit")}
          </Button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <TemplateCanvas template={template} />
        <p className="pointer-events-none absolute right-3 top-3 hidden max-w-xs rounded-md bg-card/70 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur-sm md:block">
          {t("templates.builder.previewHint")}
        </p>
      </div>
    </div>
  );
}
