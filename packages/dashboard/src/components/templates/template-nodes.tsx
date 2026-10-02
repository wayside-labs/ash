"use client";

import type { Node, NodeProps, NodeTypes } from "@xyflow/react";
import { Bot, Landmark, Send, Zap } from "lucide-react";
import { memo } from "react";
import { FlowNodeShell } from "@/components/flow/base-node";
import { FlowSourceHandle, FlowTargetHandle } from "@/components/flow/flow-handles";
import { Badge } from "@/components/ui/badge";
import { useTranslation } from "@/i18n/locale-provider";
import type { TemplateNode } from "@/lib/templates/template-graph";

/**
 * Template preview boxes. They share `FlowNodeShell` and the handles with the live canvas so
 * a starter looks like the workflow it becomes, but they read template data (a daily cap, a
 * rails mode) instead of rows, which is why they are not the live node components.
 */

type Of<K extends TemplateNode["kind"]> = Node<Extract<TemplateNode, { kind: K }>, K>;

function TreasuryBox({ data, selected }: NodeProps<Of<"treasury">>) {
  const { t } = useTranslation();
  return (
    <>
      <FlowNodeShell
        selected={selected}
        accentClass="text-ceiling"
        icon={<Landmark className="h-4 w-4" />}
        title={data.name}
        subtitle={t("templates.builder.treasury")}
      >
        <p className="text-xs text-muted-foreground">
          {t("templates.builder.agentsCount", { count: data.agentCount })}
        </p>
      </FlowNodeShell>
      <FlowSourceHandle id="out" />
    </>
  );
}

function AgentBox({ data, selected }: NodeProps<Of<"agent">>) {
  const { t } = useTranslation();
  return (
    <>
      <FlowTargetHandle id="in" />
      <FlowNodeShell
        selected={selected}
        accentClass="text-primary"
        icon={<Bot className="h-4 w-4" />}
        title={data.name}
        subtitle={data.role || t("templates.builder.agent")}
      >
        <div className="flex items-center justify-between gap-2">
          <Badge variant={data.railsMcp === "full" ? "success" : "outline"} className="text-[10px]">
            {t(`templates.builder.rails.${data.railsMcp}`)}
          </Badge>
          <span className="num text-[10px] text-muted-foreground">
            {data.dailyLimitUsd > 0
              ? t("templates.builder.cap", { amount: data.dailyLimitUsd })
              : t("templates.builder.noSpend")}
          </span>
        </div>
      </FlowNodeShell>
      <FlowSourceHandle id="out" />
    </>
  );
}

function ToolBox({ data, selected }: NodeProps<Of<"action">>) {
  const { t } = useTranslation();
  return (
    <>
      <FlowTargetHandle id="in" />
      <FlowNodeShell
        selected={selected}
        accentClass="text-accent"
        icon={<Zap className="h-4 w-4" />}
        title={data.name}
        subtitle={data.shared ? t("templates.builder.toolShared") : t("templates.builder.tool")}
      >
        <p className="line-clamp-2 text-xs text-muted-foreground">{data.description}</p>
      </FlowNodeShell>
    </>
  );
}

function PayeeBox({ data, selected }: NodeProps<Of<"payee">>) {
  const { t } = useTranslation();
  return (
    <>
      <FlowTargetHandle id="in" />
      <FlowNodeShell
        selected={selected}
        accentClass="text-good"
        icon={<Send className="h-4 w-4" />}
        title={data.name}
        subtitle={t("templates.builder.payee")}
      >
        <p className="truncate text-xs text-muted-foreground">
          {t("templates.builder.paidBy", { names: data.paidBy.join(", ") })}
        </p>
      </FlowNodeShell>
    </>
  );
}

export const templateNodeTypes: NodeTypes = {
  treasury: memo(TreasuryBox),
  agent: memo(AgentBox),
  action: memo(ToolBox),
  payee: memo(PayeeBox),
};
