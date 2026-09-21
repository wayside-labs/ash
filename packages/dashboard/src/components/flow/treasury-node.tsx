"use client";

import type { Node, NodeProps } from "@xyflow/react";
import { Landmark } from "lucide-react";
import { memo } from "react";
import { FlowNodeShell } from "@/components/flow/base-node";
import { FlowSourceHandle, FlowTargetHandle } from "@/components/flow/flow-handles";
import type { TreasuryNodeData } from "@/components/flow/types";

type TreasuryNodeType = Node<TreasuryNodeData, "treasury">;

function TreasuryNodeComponent({ data, selected }: NodeProps<TreasuryNodeType>) {
  return (
    <>
      <FlowTargetHandle id="in" />
      <FlowNodeShell
        selected={selected}
        accentClass="text-ceiling"
        icon={<Landmark className="h-4 w-4" />}
        title={data.label}
        subtitle="Treasury vault"
      >
        <dl className="space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Vault balance</dt>
            <dd className="num num-col font-medium tabular-nums">{data.balanceLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Policy limits</dt>
            <dd className="num num-col text-muted-foreground tabular-nums">{data.limitLabel}</dd>
          </div>
          {data.vaultHint ? (
            <p className="num truncate pt-0.5 text-[10px] text-faint-foreground">
              {data.vaultHint}
            </p>
          ) : null}
        </dl>
      </FlowNodeShell>
      <FlowSourceHandle id="out" />
    </>
  );
}

export const TreasuryNode = memo(TreasuryNodeComponent);
