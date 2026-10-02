"use client";

import { LayoutGrid, List } from "lucide-react";
import { useTranslation } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";
import { type TemplatesView, useAppStore } from "@/stores/app-store";

const OPTIONS: { view: TemplatesView; icon: typeof List; labelKey: string }[] = [
  { view: "list", icon: List, labelKey: "templates.view.list" },
  { view: "cards", icon: LayoutGrid, labelKey: "templates.view.cards" },
];

/** The same switch on both layouts, so the way back is always where you left it. */
export function TemplateViewToggle() {
  const { t } = useTranslation();
  const view = useAppStore((s) => s.templatesView);
  const setView = useAppStore((s) => s.setTemplatesView);

  return (
    <fieldset className="m-0 inline-flex min-w-0 rounded-lg border border-border p-0.5">
      <legend className="sr-only">{t("templates.view.label")}</legend>
      {OPTIONS.map(({ view: option, icon: Icon, labelKey }) => (
        <button
          key={option}
          type="button"
          aria-pressed={view === option}
          aria-label={t(labelKey)}
          title={t(labelKey)}
          onClick={() => setView(option)}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors",
            "hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
            view === option && "bg-muted text-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
    </fieldset>
  );
}
