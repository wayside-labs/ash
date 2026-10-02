"use client";

import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { TemplateViewToggle } from "@/components/templates/template-view-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTranslation } from "@/i18n/locale-provider";
import type { StoredWorkflowTemplate } from "@/lib/schema";
import { cn } from "@/lib/utils";

function matches(template: StoredWorkflowTemplate, needle: string): boolean {
  if (!needle) return true;
  return [template.name, template.summary, template.description].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

function Group({
  title,
  count,
  children,
  forceOpen,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  forceOpen: boolean;
}) {
  const [open, setOpen] = useState(true);
  const shown = open || forceOpen;
  return (
    <section>
      <button
        type="button"
        aria-expanded={shown}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", !shown && "-rotate-90")} />
        <span className="flex-1">{title}</span>
        <span className="num rounded-md bg-muted px-1.5 py-0.5 text-[10px]">{count}</span>
      </button>
      {shown && <ul className="space-y-0.5 px-2 pb-2">{children}</ul>}
    </section>
  );
}

function Row({
  template,
  selected,
  onSelect,
  onDelete,
  deleteLabel,
}: {
  template: StoredWorkflowTemplate;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  deleteLabel: string;
}) {
  return (
    <li className="group relative">
      <button
        type="button"
        aria-current={selected ? "true" : undefined}
        data-testid="template-row"
        onClick={onSelect}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors",
          "hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
          selected && "bg-primary/10 ring-1 ring-primary/30",
          onDelete && "pr-10",
        )}
      >
        <span className="text-lg" aria-hidden>
          {template.icon}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{template.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {template.summary || template.description}
          </span>
        </span>
      </button>
      {onDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={deleteLabel}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </li>
  );
}

/**
 * The templates menu, on the right of the builder. Starters and your own presets are two
 * collapsible groups, like the component list of a node editor, and a search narrows both.
 */
export function TemplateListPanel({
  starters,
  custom,
  selectedId,
  onSelect,
  onCreate,
  onDelete,
}: {
  starters: StoredWorkflowTemplate[];
  custom: StoredWorkflowTemplate[];
  selectedId: string | null;
  onSelect: (template: StoredWorkflowTemplate) => void;
  onCreate: () => void;
  onDelete: (template: StoredWorkflowTemplate) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const shownStarters = useMemo(
    () => starters.filter((row) => matches(row, needle)),
    [starters, needle],
  );
  const shownCustom = useMemo(() => custom.filter((row) => matches(row, needle)), [custom, needle]);
  const nothing = shownStarters.length === 0 && shownCustom.length === 0;

  return (
    <aside
      aria-label={t("templates.title")}
      className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-border bg-sidebar max-md:order-first max-md:border-b md:max-h-none md:w-80 md:border-l"
    >
      <div className="space-y-3 border-b border-border px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold tracking-tight">{t("templates.title")}</h1>
          <div className="flex items-center gap-2">
            <TemplateViewToggle />
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="h-8 w-8"
              aria-label={t("templates.create.button")}
              title={t("templates.create.button")}
              onClick={onCreate}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("templates.panel.search")}
            aria-label={t("templates.panel.search")}
            className="h-8 pl-8 text-sm"
          />
        </div>
      </div>

      {/* Not ScrollArea: its viewport wraps children in display:table, which lets rows outgrow the panel and defeats truncate. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="py-1">
          {nothing && (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              {t("templates.panel.noMatches", { query: query.trim() })}
            </p>
          )}
          {shownStarters.length > 0 && (
            <Group
              title={t("templates.section.starters")}
              count={shownStarters.length}
              forceOpen={needle !== ""}
            >
              {shownStarters.map((row) => (
                <Row
                  key={row.id}
                  template={row}
                  selected={row.id === selectedId}
                  onSelect={() => onSelect(row)}
                  deleteLabel=""
                />
              ))}
            </Group>
          )}
          {(shownCustom.length > 0 || needle === "") && (
            <Group
              title={t("templates.section.yours")}
              count={shownCustom.length}
              forceOpen={needle !== ""}
            >
              {shownCustom.length === 0 && needle === "" ? (
                <li className="px-3 py-2 text-xs text-muted-foreground">
                  {t("templates.emptyDescription")}
                </li>
              ) : (
                shownCustom.map((row) => (
                  <Row
                    key={row.id}
                    template={row}
                    selected={row.id === selectedId}
                    onSelect={() => onSelect(row)}
                    onDelete={() => onDelete(row)}
                    deleteLabel={t("templates.delete")}
                  />
                ))
              )}
            </Group>
          )}
        </div>
      </div>
    </aside>
  );
}
