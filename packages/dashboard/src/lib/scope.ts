import type { Scope } from "@/lib/schema";
import type { Agent, Workflow } from "@/lib/types";

/** Whether a scoped MCP, skill, or document applies to this agent. */
export function appliesToAgent(
  item: { scope: Scope; scopeName: string | null },
  // Only the names decide scope, so the stored rows and the presented ones both qualify.
  agent: Pick<Agent, "name">,
  workflow: Pick<Workflow, "name">,
): boolean {
  switch (item.scope) {
    case "global":
      return true;
    case "workflow":
      return item.scopeName === workflow.name;
    case "agent":
      return item.scopeName === agent.name;
  }
}

export function scopeBadgeLabel(
  item: { scope: Scope; scopeName: string | null },
  t: (key: string) => string,
): string {
  switch (item.scope) {
    case "global":
      return t("common.global");
    case "workflow":
      return item.scopeName ?? t("common.byWorkflow");
    case "agent":
      return item.scopeName ?? t("common.byAgent");
  }
}
