"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/i18n/locale-provider";
import type { MetricsScope } from "@/lib/metrics/schema";
import type { Workflow } from "@/lib/types";
import { mintSymbol } from "@/lib/utils";

/**
 * Workflow, then agent, then mint — the drill-down path §B describes, as three
 * cascading selects rather than three pages.
 *
 * The agent list is scoped to the chosen workflow, and a workflow change clears
 * an agent that no longer belongs to it. Leaving a stale agent id in the URL
 * would silently narrow every number on the page to a session in another vault.
 */
const ALL = "__all__";

export function ScopeSelector({
  workflows,
  scope,
  onChange,
  mints,
}: {
  workflows: Workflow[];
  scope: MetricsScope;
  onChange: (next: MetricsScope) => void;
  mints: string[];
}) {
  const { t } = useTranslation();
  const selected = workflows.find((w) => w.id === scope.workflowId);
  const agents = selected ? selected.agents : workflows.flatMap((w) => w.agents);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={scope.workflowId ?? ALL}
        onValueChange={(next) =>
          onChange({
            ...scope,
            workflowId: next === ALL ? null : next,
            // An agent from the previous workflow is not in this one.
            agentId: null,
          })
        }
      >
        <SelectTrigger className="h-8 w-[190px] text-xs" aria-label={t("metrics.scope.workflow")}>
          <SelectValue placeholder={t("metrics.scope.allWorkflows")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("metrics.scope.allWorkflows")}</SelectItem>
          {workflows.map((workflow) => (
            <SelectItem key={workflow.id} value={workflow.id}>
              {workflow.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={scope.agentId ?? ALL}
        onValueChange={(next) => onChange({ ...scope, agentId: next === ALL ? null : next })}
      >
        <SelectTrigger className="h-8 w-[170px] text-xs" aria-label={t("metrics.scope.agent")}>
          <SelectValue placeholder={t("metrics.scope.allAgents")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("metrics.scope.allAgents")}</SelectItem>
          {agents.map((agent) => (
            <SelectItem key={agent.id} value={agent.id}>
              {agent.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={scope.mint ?? ALL}
        onValueChange={(next) => onChange({ ...scope, mint: next === ALL ? null : next })}
      >
        <SelectTrigger className="h-8 w-[140px] text-xs" aria-label={t("metrics.scope.token")}>
          <SelectValue placeholder={t("metrics.scope.allTokens")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("metrics.scope.allTokens")}</SelectItem>
          {mints.map((mint) => (
            <SelectItem key={mint} value={mint}>
              {mintSymbol(mint)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
