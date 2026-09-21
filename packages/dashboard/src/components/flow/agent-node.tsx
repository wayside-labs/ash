"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { Bot } from "lucide-react";
import { memo } from "react";
import { FlowNodeShell } from "@/components/flow/base-node";
import { FlowSourceHandle, FlowTargetHandle } from "@/components/flow/flow-handles";
import type { AgentNodeData } from "@/components/flow/types";
import { Badge } from "@/components/ui/badge";

type AgentNodeType = Node<AgentNodeData, "agent">;

function statusVariant(status: AgentNodeData["status"]) {
  switch (status) {
    case "active":
      return "success" as const;
    case "paused":
      return "warning" as const;
    default:
      return "secondary" as const;
  }
}

function AgentNodeComponent({ data, selected }: NodeProps<AgentNodeType>) {
  return (
    <>
      <FlowTargetHandle id="in" />
      <FlowNodeShell
        selected={selected}
        accentClass="text-primary"
        icon={<Bot className="h-4 w-4" />}
        title={data.name}
        subtitle={data.role || "AI agent"}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Status</span>
          <Badge variant={statusVariant(data.status)} className="text-[10px] capitalize">
            {data.status}
          </Badge>
        </div>
      </FlowNodeShell>
      <FlowSourceHandle id="out" />
    </>
  );
}

export const AgentNode = memo(AgentNodeComponent);
