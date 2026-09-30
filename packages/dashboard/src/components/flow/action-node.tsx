"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { Zap } from "lucide-react";
import { memo } from "react";
import { FlowNodeShell } from "@/components/flow/base-node";
import { FlowSourceHandle, FlowTargetHandle } from "@/components/flow/flow-handles";
import type { ActionNodeData } from "@/components/flow/types";
import { Badge } from "@/components/ui/badge";

type ActionNodeType = Node<ActionNodeData, "action">;

function ActionNodeComponent({ data, selected }: NodeProps<ActionNodeType>) {
  return (
    <>
      <FlowTargetHandle id="in" />
      <FlowNodeShell
        selected={selected}
        accentClass="text-accent"
        icon={<Zap className="h-4 w-4" />}
        title={data.name}
        subtitle={data.provider}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {data.shared ? "MCP · shared" : "MCP"}
          </span>
          <Badge variant={data.enabled ? "success" : "outline"} className="text-[10px]">
            {data.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
      </FlowNodeShell>
      <FlowSourceHandle id="out" />
    </>
  );
}

export const ActionNode = memo(ActionNodeComponent);
