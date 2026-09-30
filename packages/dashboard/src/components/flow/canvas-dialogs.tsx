"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useTranslation } from "@/i18n/locale-provider";
import type { ValidatedProposal } from "@/lib/canvas-proposal";
import type { McpServer } from "@/lib/types";

/** Pick an existing MCP to bring into this workflow. Creating one stays on /mcps. */
export function McpPickerDialog({
  open,
  onOpenChange,
  candidates,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  candidates: McpServer[];
  onPick: (mcp: McpServer) => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("flowCanvas.picker.title")}</DialogTitle>
          <DialogDescription>{t("flowCanvas.picker.description")}</DialogDescription>
        </DialogHeader>
        {candidates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("flowCanvas.picker.empty")}</p>
        ) : (
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {candidates.map((mcp) => (
              <li key={mcp.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => onPick(mcp)}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{mcp.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {mcp.description}
                    </span>
                  </span>
                  <Badge variant="outline">{mcp.scopeName ?? mcp.scope}</Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
        <Button variant="outline" asChild>
          <Link href="/mcps">{t("flowCanvas.picker.create")}</Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** Delete from the canvas asks what is meant (plan D3): hide the box, or delete the row. */
export function RemoveNodeDialog({
  target,
  onOpenChange,
  onHide,
  onDelete,
}: {
  target: { kind: "agent" | "action"; name: string } | null;
  onOpenChange: (open: boolean) => void;
  onHide: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("flowCanvas.remove.title", { name: target?.name ?? "" })}</DialogTitle>
          <DialogDescription>
            {t(target?.kind === "agent" ? "flowCanvas.remove.agent" : "flowCanvas.remove.action")}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onHide}>
            {t("flowCanvas.remove.hide")}
          </Button>
          <Button variant="destructive" onClick={onDelete}>
            {t(
              target?.kind === "agent"
                ? "flowCanvas.remove.deleteAgent"
                : "flowCanvas.remove.deleteAction",
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ProposalDialog({
  proposal,
  applying,
  onOpenChange,
  onApply,
}: {
  proposal: ValidatedProposal | null;
  applying: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: () => void;
}) {
  const { t } = useTranslation();
  if (!proposal) return null;
  const empty =
    proposal.newAgents.length +
      proposal.payees.length +
      proposal.tools.length +
      proposal.skills.length +
      proposal.connectors.length ===
    0;
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("flowCanvas.ai.previewTitle")}</DialogTitle>
          <DialogDescription>
            {proposal.summary || t("flowCanvas.ai.previewDescription")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {proposal.newAgents.length > 0 && (
            <section>
              <p className="font-medium">{t("flowCanvas.ai.newAgents")}</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {proposal.newAgents.map((a) => (
                  <li key={a.name}>
                    {a.name} — {a.role}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {proposal.payees.length > 0 && (
            <section>
              <p className="font-medium">{t("flowCanvas.ai.payees")}</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {proposal.payees.map((p) => (
                  <li key={`${p.from}-${p.to}`}>
                    {p.from} → {p.to}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {proposal.tools.length > 0 && (
            <section>
              <p className="font-medium">{t("flowCanvas.ai.tools")}</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {proposal.tools.map((tool) => (
                  <li key={`${tool.mcpId}-${tool.agent}`}>
                    {tool.mcpName} → {tool.agent}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {proposal.skills.length > 0 && (
            <section>
              <p className="font-medium">{t("flowCanvas.ai.skills")}</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {proposal.skills.map((skill) => (
                  <li key={`${skill.skillId}-${skill.agent}`}>
                    {skill.skillName} → {skill.agent}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {proposal.connectors.length > 0 && (
            <section data-testid="proposal-connectors">
              <p className="font-medium">{t("flowCanvas.ai.connectors")}</p>
              <ul className="list-inside list-disc text-muted-foreground">
                {proposal.connectors.map(({ bundle, agents }) => (
                  <li key={bundle.name}>
                    <span className="num">{bundle.name}</span> → {agents.join(", ")}
                    <span className="block pl-4 text-xs">
                      {bundle.tools.map((tool) => `${tool.method} ${tool.name}`).join(" · ")}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("flowCanvas.ai.connectorsHint")}
              </p>
            </section>
          )}
          {proposal.warnings.length > 0 && (
            <section className="rounded-md bg-warning/10 p-2 text-xs">
              {proposal.warnings.map((w) => (
                <p key={w} className="flex items-start gap-1">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-warning" />
                  {w}
                </p>
              ))}
            </section>
          )}
          <p className="text-xs text-muted-foreground">{t("flowCanvas.ai.noPrivilege")}</p>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button onClick={onApply} disabled={empty || applying}>
            {applying && <Loader2 className="h-4 w-4 animate-spin" />}
            {t("flowCanvas.ai.apply")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
