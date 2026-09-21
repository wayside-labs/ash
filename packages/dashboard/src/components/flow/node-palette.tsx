"use client";

import { Bot, GripVertical, Zap } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";
import type { FlowNodeKind, PaletteDragPayload } from "./types";

const DRAG_MIME = "application/reactflow";

export function paletteDragPayload(event: React.DragEvent, payload: PaletteDragPayload) {
  event.dataTransfer.setData(DRAG_MIME, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "move";
}

export function readPaletteDragPayload(event: React.DragEvent): PaletteDragPayload | null {
  const raw = event.dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PaletteDragPayload;
  } catch {
    return null;
  }
}

export { DRAG_MIME };

type PaletteItem = {
  type: FlowNodeKind;
  labelKey: string;
  descriptionKey: string;
  icon: typeof Bot;
  accent: string;
  buildPayload: () => PaletteDragPayload;
};

function PaletteRow({
  item,
  onDragStart,
}: {
  item: PaletteItem;
  onDragStart: (event: React.DragEvent) => void;
}) {
  const { t } = useTranslation();
  const Icon = item.icon;

  return (
    <button
      type="button"
      draggable
      onDragStart={onDragStart}
      className={cn(
        "surface-card group flex w-full cursor-grab items-center gap-3 rounded-lg px-3 py-2.5 text-left",
        "transition-colors hover:border-primary/30 active:cursor-grabbing",
      )}
    >
      <GripVertical className="h-4 w-4 shrink-0 text-faint-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted",
          item.accent,
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{t(item.labelKey)}</p>
        <p className="truncate text-xs text-muted-foreground">{t(item.descriptionKey)}</p>
      </div>
    </button>
  );
}

export function NodePalette({ workflowId, className }: { workflowId: string; className?: string }) {
  const { t } = useTranslation();

  const items: PaletteItem[] = [
    {
      type: "agent",
      labelKey: "flowCanvas.palette.agent",
      descriptionKey: "flowCanvas.palette.agentHint",
      icon: Bot,
      accent: "text-primary",
      buildPayload: () => ({
        type: "agent",
        data: {
          kind: "agent",
          name: t("flowCanvas.palette.newAgent"),
          role: t("flowCanvas.palette.agentRole"),
          status: "active",
        },
      }),
    },
    {
      type: "action",
      labelKey: "flowCanvas.palette.jupiter",
      descriptionKey: "flowCanvas.palette.actionHint",
      icon: Zap,
      accent: "text-accent",
      buildPayload: () => ({
        type: "action",
        data: {
          kind: "action",
          name: "Jupiter Swap",
          provider: "Jupiter",
          enabled: true,
        },
      }),
    },
    {
      type: "action",
      labelKey: "flowCanvas.palette.kamino",
      descriptionKey: "flowCanvas.palette.actionHint",
      icon: Zap,
      accent: "text-accent",
      buildPayload: () => ({
        type: "action",
        data: {
          kind: "action",
          name: "Kamino Lend",
          provider: "Kamino",
          enabled: true,
        },
      }),
    },
  ];

  return (
    <aside
      className={cn(
        "surface-card flex w-64 shrink-0 flex-col border-r border-border bg-sidebar",
        className,
      )}
    >
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm font-medium">{t("flowCanvas.palette.title")}</p>
        <p className="text-xs text-muted-foreground">{t("flowCanvas.palette.subtitle")}</p>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-2 p-3">
          <p className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t("flowCanvas.palette.dragHint")}
          </p>
          {items.map((item) => (
            <PaletteRow
              key={`${item.type}-${item.labelKey}`}
              item={item}
              onDragStart={(event) => paletteDragPayload(event, item.buildPayload())}
            />
          ))}
        </div>
      </ScrollArea>
      <div className="border-t border-border px-4 py-2">
        <p className="text-[10px] text-faint-foreground">
          {t("flowCanvas.palette.workflowId", { id: workflowId.slice(0, 8) })}
        </p>
      </div>
    </aside>
  );
}
