"use client";

import { ArrowLeftRight, Columns2, LayoutTemplate, Rows2 } from "lucide-react";
import dynamic from "next/dynamic";
import { Fragment } from "react";
import { WorkflowsPanel } from "@/components/home/workflows-panel";
import { Button } from "@/components/ui/button";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  useDefaultLayout,
} from "@/components/ui/resizable";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";
import { type HomePanelId, useAppStore } from "@/stores/app-store";

const ChatPanel = dynamic(
  () => import("@/components/chat/chat-panel").then((m) => ({ default: m.ChatPanel })),
  {
    ssr: false,
    loading: () => <div className="h-full min-h-[200px] animate-pulse rounded-xl bg-muted/60" />,
  },
);

const PANEL_IDS: HomePanelId[] = ["chat", "workflows"];

const DEFAULT_SIZES: Record<HomePanelId, number> = {
  chat: 42,
  workflows: 58,
};

function clearSavedPanelLayouts() {
  if (typeof window === "undefined") return;
  const prefix = "react-resizable-panels:";
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i);
    if (key?.startsWith(prefix) && key.includes("home-")) {
      localStorage.removeItem(key);
    }
  }
}

export function HomeLayout() {
  const { t } = useTranslation();
  const homeLayout = useAppStore((s) => s.homeLayout);
  const layoutResetCounter = useAppStore((s) => s.homeLayoutResetCounter);
  const swapHomePanels = useAppStore((s) => s.swapHomePanels);
  const setHomeLayoutDirection = useAppStore((s) => s.setHomeLayoutDirection);
  const resetHomeLayout = useAppStore((s) => s.resetHomeLayout);

  const storageId = `home-${homeLayout.direction}-${layoutResetCounter}`;
  const { defaultLayout, onLayoutChanged } = useDefaultLayout({
    id: storageId,
    panelIds: PANEL_IDS,
    onlySaveAfterUserInteractions: true,
  });

  const panelContent: Record<HomePanelId, React.ReactNode> = {
    chat: <ChatPanel className="h-full min-h-0" />,
    workflows: <WorkflowsPanel />,
  };

  const handleReset = () => {
    clearSavedPanelLayouts();
    resetHomeLayout();
  };

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-2">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <p className="text-xs text-muted-foreground">{t("home.layout.hint")}</p>
        <TooltipProvider delayDuration={300}>
          <div className="flex items-center gap-0.5">
            <LayoutToolbarButton
              label={t("home.layout.swap")}
              onClick={swapHomePanels}
              icon={ArrowLeftRight}
            />
            <LayoutToolbarButton
              label={t("home.layout.horizontal")}
              onClick={() => setHomeLayoutDirection("horizontal")}
              icon={Columns2}
              active={homeLayout.direction === "horizontal"}
            />
            <LayoutToolbarButton
              label={t("home.layout.vertical")}
              onClick={() => setHomeLayoutDirection("vertical")}
              icon={Rows2}
              active={homeLayout.direction === "vertical"}
            />
            <LayoutToolbarButton
              label={t("home.layout.reset")}
              onClick={handleReset}
              icon={LayoutTemplate}
            />
          </div>
        </TooltipProvider>
      </div>

      <ResizablePanelGroup
        id={storageId}
        orientation={homeLayout.direction}
        defaultLayout={defaultLayout ?? DEFAULT_SIZES}
        onLayoutChanged={onLayoutChanged}
        className="min-h-0 flex-1 rounded-xl"
      >
        {homeLayout.panelOrder.map((panelId, index) => (
          <Fragment key={panelId}>
            {index > 0 && <ResizableHandle orientation={homeLayout.direction} />}
            <ResizablePanel
              id={panelId}
              minSize={22}
              defaultSize={DEFAULT_SIZES[panelId]}
              className="min-h-0"
            >
              <div className="h-full min-h-0 overflow-hidden p-0.5">{panelContent[panelId]}</div>
            </ResizablePanel>
          </Fragment>
        ))}
      </ResizablePanelGroup>
    </div>
  );
}

function LayoutToolbarButton({
  label,
  onClick,
  icon: Icon,
  active = false,
}: {
  label: string;
  onClick: () => void;
  icon: React.ComponentType<{ className?: string }>;
  active?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant={active ? "secondary" : "ghost"}
          size="icon"
          className={cn("h-8 w-8", active && "text-primary")}
          onClick={onClick}
          aria-label={label}
        >
          <Icon className="h-4 w-4" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}
