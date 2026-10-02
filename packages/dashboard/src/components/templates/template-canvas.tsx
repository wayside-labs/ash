"use client";

import {
  Background,
  BackgroundVariant,
  Controls,
  type Edge,
  type Node,
  Panel,
  ReactFlow,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "@/components/flow/flow-theme.css";
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { templateNodeTypes } from "@/components/templates/template-nodes";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/locale-provider";
import type { StoredWorkflowTemplate } from "@/lib/schema";
import { buildTemplateGraph, type TemplateNode } from "@/lib/templates/template-graph";

const fitViewOptions = { padding: 0.25, maxZoom: 1 };

function Inspector({ node, onClose }: { node: TemplateNode; onClose: () => void }) {
  const { t } = useTranslation();
  const lines: string[] = [];
  let title = node.name;

  switch (node.kind) {
    case "agent":
      lines.push(node.role || t("templates.builder.agent"));
      lines.push(t(`templates.builder.rails.${node.railsMcp}`));
      lines.push(
        node.dailyLimitUsd > 0
          ? t("templates.builder.cap", { amount: node.dailyLimitUsd })
          : t("templates.builder.noSpend"),
      );
      if (node.paysTo.length > 0) {
        lines.push(t("templates.builder.paysTo", { names: node.paysTo.join(", ") }));
      }
      break;
    case "action":
      lines.push(node.description);
      lines.push(node.shared ? t("templates.builder.toolShared") : t("templates.builder.tool"));
      break;
    case "payee":
      lines.push(t("templates.builder.paidBy", { names: node.paidBy.join(", ") }));
      lines.push(t("templates.builder.payeeHint"));
      break;
    case "treasury":
      title = `${node.name} · ${t("templates.builder.treasury")}`;
      lines.push(t("templates.builder.treasuryHint"));
      break;
  }

  return (
    <div
      data-testid="template-inspector"
      className="surface-card w-72 max-w-[calc(100vw-2rem)] space-y-1.5 rounded-xl p-3 text-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium leading-tight">{title}</p>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="-mr-1 -mt-1 h-6 w-6"
          aria-label={t("common.close")}
          onClick={onClose}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {lines.map((line) => (
        <p key={line} className="text-muted-foreground">
          {line}
        </p>
      ))}
    </div>
  );
}

function TemplateCanvasInner({ template }: { template: StoredWorkflowTemplate }) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const graph = useMemo(() => buildTemplateGraph(template), [template]);
  const nodes = useMemo<Node[]>(
    () =>
      graph.nodes.map((node) => ({
        id: node.id,
        type: node.kind,
        position: node.position,
        data: node,
        selected: node.id === selectedId,
        draggable: false,
        connectable: false,
        deletable: false,
      })),
    [graph, selectedId],
  );
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        deletable: false,
        focusable: false,
        animated: edge.kind === "pays",
        ...(edge.kind === "tool" ? { style: { strokeDasharray: "4 4" } } : {}),
      })),
    [graph],
  );
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={templateNodeTypes}
      fitView
      fitViewOptions={fitViewOptions}
      nodesDraggable={false}
      nodesConnectable={false}
      edgesFocusable={false}
      onNodeClick={(_event, node) => setSelectedId(node.id)}
      onPaneClick={() => setSelectedId(null)}
      aria-label={t("templates.builder.canvasLabel")}
      className="bg-background"
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls showInteractive={false} />
      {template.agents.length === 0 && (
        <Panel position="top-center">
          <p className="surface-card max-w-sm rounded-lg px-3 py-2 text-center text-xs text-muted-foreground">
            {t("templates.builder.noAgents")}
          </p>
        </Panel>
      )}
      {selected && (
        <Panel position="top-left">
          <Inspector node={selected} onClose={() => setSelectedId(null)} />
        </Panel>
      )}
    </ReactFlow>
  );
}

/** Keyed by template so switching starters re-fits the view and drops the old selection. */
export function TemplateCanvas({ template }: { template: StoredWorkflowTemplate }) {
  return (
    <ReactFlowProvider key={template.id}>
      <TemplateCanvasInner template={template} />
    </ReactFlowProvider>
  );
}
