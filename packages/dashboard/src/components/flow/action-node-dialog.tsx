"use client";

import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { useUpdateResource } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import type { McpServer } from "@/lib/types";

/** Lightweight MCP editor for action nodes — full config lives on /mcps. */
export function ActionNodeDialog({
  mcp,
  open,
  onOpenChange,
}: {
  mcp: McpServer;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const update = useUpdateResource("mcps");
  const toast = useToast();

  const toggle = async (enabled: boolean) => {
    try {
      await update.mutateAsync({ id: mcp.id, enabled });
      toast(
        enabled
          ? t("common.itemEnabled", { name: mcp.name })
          : t("common.itemDisabled", { name: mcp.name }),
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToUpdate"), "error");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mcp.name}</DialogTitle>
          <DialogDescription>
            {mcp.description || t("flowCanvas.actionDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2">
          <span className="text-sm">{t("common.enabled")}</span>
          <Switch
            checked={mcp.enabled}
            disabled={update.isPending}
            onCheckedChange={toggle}
            aria-label={t("mcps.aria.enable", { name: mcp.name })}
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.close")}
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/mcps">
              <ExternalLink className="h-3.5 w-3.5" />
              {t("flowCanvas.actionDialog.openMcps")}
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
