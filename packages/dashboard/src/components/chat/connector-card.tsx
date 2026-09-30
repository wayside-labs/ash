"use client";

import {
  CONNECTOR_FENCE,
  type ConnectorProposal,
  connectorSecretEnv,
} from "@agent-rails/contract/connector-bundle";
import { AlertTriangle, Cable, Check, Loader2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDashboardState, useImportConnector } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";

const FENCE_BLOCK = new RegExp(`\`\`\`${CONNECTOR_FENCE}[^\\n]*\\n[\\s\\S]*?\`\`\``, "g");

/** The reply with its connector blocks taken out — they render as cards, not as raw JSON. */
export function withoutConnectorBlocks(content: string): string {
  return content.replace(FENCE_BLOCK, "").replace(/\n{3,}/g, "\n\n");
}

const GLOBAL = "__global__";

/**
 * A connector the chat proposed. The model cannot install anything: this card is the
 * operator's decision point, and the server re-validates the bundle before writing it.
 */
export function ConnectorProposalCard({ proposal }: { proposal: ConnectorProposal }) {
  const { t } = useTranslation();
  const toast = useToast();
  const state = useDashboardState();
  const importConnector = useImportConnector();
  const workflows = state.data?.workflows ?? [];
  const [target, setTarget] = useState<string>("");
  const [added, setAdded] = useState(false);

  if (!proposal.ok) {
    return (
      <div
        data-testid="connector-proposal-invalid"
        className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
      >
        <p className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
          {t("connectors.chat.invalid")}
        </p>
        <p className="mt-1 break-words text-muted-foreground">{proposal.error}</p>
      </div>
    );
  }

  const { bundle } = proposal;
  const secrets = connectorSecretEnv(bundle);
  const chosen = target || workflows[0]?.name || GLOBAL;

  const add = async () => {
    try {
      const res = await importConnector.mutateAsync({
        bundle,
        scope: chosen === GLOBAL ? "global" : "workflow",
        scopeName: chosen === GLOBAL ? null : chosen,
        enabled: true,
      });
      setAdded(true);
      toast(
        res.missingEnv.length > 0
          ? t("connectors.addedNeedsEnv", { name: bundle.name, env: res.missingEnv.join(", ") })
          : t("connectors.added", { name: bundle.name }),
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : t("common.failedToAdd"), "error");
    }
  };

  return (
    <div
      data-testid="connector-proposal"
      className="mt-2 space-y-2 rounded-lg border border-border bg-background/60 p-3 text-xs"
    >
      <div className="flex items-center gap-2">
        <Cable className="h-3.5 w-3.5 text-primary" />
        <span className="num font-medium">{bundle.name}</span>
        <Badge variant="outline">{t("connectors.chat.draft")}</Badge>
      </div>
      {bundle.description && <p className="text-muted-foreground">{bundle.description}</p>}
      <ul className="space-y-0.5">
        {bundle.tools.map((tool) => (
          <li key={tool.name} className="num text-muted-foreground">
            {tool.method} {tool.name}
          </li>
        ))}
      </ul>
      {secrets.length > 0 && (
        <p className="text-muted-foreground">
          {t("connectors.chat.secrets", { env: secrets.join(", ") })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        <Select value={chosen} onValueChange={setTarget} disabled={added}>
          <SelectTrigger className="h-7 w-auto min-w-40 text-xs" aria-label={t("common.scope")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {workflows.map((w) => (
              <SelectItem key={w.id} value={w.name}>
                {w.name}
              </SelectItem>
            ))}
            <SelectItem value={GLOBAL}>{t("common.global")}</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" onClick={add} disabled={added || importConnector.isPending}>
          {importConnector.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : added ? (
            <Check className="h-3.5 w-3.5" />
          ) : null}
          {added ? t("connectors.chat.added") : t("connectors.chat.add")}
        </Button>
      </div>
      <p className="text-[11px] text-faint-foreground">{t("connectors.chat.noPrivilege")}</p>
    </div>
  );
}
