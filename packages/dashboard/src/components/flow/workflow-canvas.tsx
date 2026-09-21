"use client";

import {
  addEdge,
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  MiniMap,
  type Node,
  type NodeMouseHandler,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";
import { NodePalette, readPaletteDragPayload } from "@/components/flow/node-palette";
import { flowNodeTypes } from "@/components/flow/node-types";
import type { ActionNodeData, FlowNodeData, TreasuryNodeData } from "@/components/flow/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { AgentSettingsSheet } from "@/components/workflows/agent-settings-sheet";
import { CreateAgentDialog, EditWorkflowDialog } from "@/components/workflows/workflow-dialogs";
import "@/components/flow/flow-theme.css";
import { useDashboardState, useWorkflows } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import type { Agent, McpServer, Workflow } from "@/lib/types";
import { formatMoney, truncateAddress } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";
import { ActionNodeDialog } from "./action-node-dialog";

function nodeId(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function buildInitialGraph(
  workflow: Workflow,
  mcps: McpServer[],
  hidden: boolean,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const treasuryId = `treasury-${workflow.id}`;
  const treasuryData: TreasuryNodeData = {
    kind: "treasury",
    workflowId: workflow.id,
    label: workflow.name,
    balanceLabel: formatMoney(workflow.balance, hidden),
    limitLabel: workflow.agents.length > 0 ? `${workflow.agents.length} agents` : "—",
    vaultHint: workflow.treasuryAddress ? truncateAddress(workflow.treasuryAddress, 6) : undefined,
  };

  const nodes: Node<FlowNodeData>[] = [
    {
      id: treasuryId,
      type: "treasury",
      position: { x: 40, y: 160 },
      data: treasuryData,
    },
  ];

  const edges: Edge[] = [];

  workflow.agents.forEach((agent, index) => {
    const id = `agent-${agent.id}`;
    nodes.push({
      id,
      type: "agent",
      position: { x: 340, y: 60 + index * 150 },
      data: {
        kind: "agent",
        agentId: agent.id,
        name: agent.name,
        role: agent.role,
        status: agent.status,
      },
    });
    edges.push({
      id: `e-${treasuryId}-${id}`,
      source: treasuryId,
      target: id,
      animated: false,
    });
  });

  const scopedMcps = mcps.filter(
    (mcp) =>
      mcp.scope === "global" || (mcp.scope === "workflow" && mcp.scopeName === workflow.name),
  );

  scopedMcps.slice(0, 4).forEach((mcp, index) => {
    const id = `action-${mcp.id}`;
    const agentAnchor = workflow.agents[index % Math.max(workflow.agents.length, 1)];
    nodes.push({
      id,
      type: "action",
      position: { x: 640, y: 80 + index * 130 },
      data: {
        kind: "action",
        mcpId: mcp.id,
        name: mcp.name,
        provider: mcp.description || "MCP",
        enabled: mcp.enabled,
      },
    });
    if (agentAnchor) {
      edges.push({
        id: `e-agent-${agentAnchor.id}-${id}`,
        source: `agent-${agentAnchor.id}`,
        target: id,
        animated: mcp.enabled,
      });
    }
  });

  return { nodes, edges };
}

function WorkflowCanvasInner({ workflowId }: { workflowId: string }) {
  const { t } = useTranslation();
  const hidden = useBalancesHidden();
  const toast = useToast();
  const { workflows } = useWorkflows();
  const state = useDashboardState();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const workflow = workflows.find((row) => row.id === workflowId);
  const mcps = state.data?.mcps ?? [];

  const initial = useMemo(() => {
    if (!workflow) return { nodes: [] as Node<FlowNodeData>[], edges: [] as Edge[] };
    return buildInitialGraph(workflow, mcps, hidden);
  }, [workflow, mcps, hidden]);

  const [nodes, setNodes, onNodesChange] = useNodesState(initial.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initial.edges);
  const [aiPrompt, setAiPrompt] = useState("");
  const [editingWorkflow, setEditingWorkflow] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [editingAction, setEditingAction] = useState<McpServer | null>(null);

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((current) => addEdge({ ...connection, animated: false }, current)),
    [setEdges],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const payload = readPaletteDragPayload(event);
      if (!payload || !reactFlowWrapper.current) return;

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const id =
        payload.type === "agent"
          ? nodeId("agent-new")
          : payload.type === "action"
            ? nodeId("action-new")
            : nodeId("treasury-new");

      setNodes((current) =>
        current.concat({
          id,
          type: payload.type,
          position,
          data: payload.data,
        }),
      );
    },
    [screenToFlowPosition, setNodes],
  );

  const handleAIGraphGeneration = useCallback(
    (prompt: string) => {
      if (!prompt.trim()) return;

      const agentNodes = nodes.filter((node) => node.type === "agent");
      const anchor = agentNodes.at(-1);
      const newNodeId = nodeId("action-ai");
      const actionData: ActionNodeData = {
        kind: "action",
        name: prompt.includes("Kamino") ? "Kamino Lend" : "Jupiter Swap",
        provider: prompt.includes("Kamino") ? "Kamino" : "Jupiter",
        enabled: true,
      };

      setNodes((current) =>
        current.concat({
          id: newNodeId,
          type: "action",
          position: {
            x: (anchor?.position.x ?? 320) + 280,
            y: (anchor?.position.y ?? 120) + 48,
          },
          data: actionData,
        }),
      );

      if (anchor) {
        setEdges((current) =>
          addEdge(
            {
              id: `e-ai-${anchor.id}-${newNodeId}`,
              source: anchor.id,
              target: newNodeId,
              animated: true,
            },
            current,
          ),
        );
      }

      toast(t("flowCanvas.ai.generated"));
      setAiPrompt("");
    },
    [nodes, setEdges, setNodes, t, toast],
  );

  const onNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (!workflow) return;
      const data = node.data as FlowNodeData;

      if (data.kind === "treasury") {
        setEditingWorkflow(true);
        return;
      }

      if (data.kind === "agent") {
        if (data.agentId) {
          const agent = workflow.agents.find((row) => row.id === data.agentId);
          if (agent) setEditingAgent(agent);
          else setCreatingAgent(true);
        } else {
          setCreatingAgent(true);
        }
        return;
      }

      if (data.kind === "action" && data.mcpId) {
        const mcp = mcps.find((row) => row.id === data.mcpId);
        if (mcp) setEditingAction(mcp);
      }
    },
    [mcps, workflow],
  );

  if (!workflow) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">{t("flowCanvas.notFound")}</p>
        <Button variant="outline" asChild>
          <Link href="/workflows">
            <ArrowLeft className="h-4 w-4" />
            {t("flowCanvas.backToWorkflows")}
          </Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <NodePalette workflowId={workflow.id} />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-border bg-card/40 px-4 py-2.5 backdrop-blur-sm">
          <div className="flex min-w-0 items-center gap-3">
            <Button variant="ghost" size="icon" asChild>
              <Link href="/workflows" aria-label={t("flowCanvas.backToWorkflows")}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {workflow.icon} {workflow.name}
              </p>
              <p className="truncate text-xs text-muted-foreground">{t("flowCanvas.subtitle")}</p>
            </div>
          </div>
          <form
            className="flex max-w-md flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              handleAIGraphGeneration(aiPrompt);
            }}
          >
            <Input
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder={t("flowCanvas.ai.placeholder")}
              className="h-9 text-sm"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!aiPrompt.trim()}>
              <Sparkles className="h-3.5 w-3.5" />
              {t("flowCanvas.ai.generate")}
            </Button>
          </form>
        </div>

        <div ref={reactFlowWrapper} className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onNodeClick={onNodeClick}
            nodeTypes={flowNodeTypes}
            deleteKeyCode="Backspace"
            fitView
            fitViewOptions={{ padding: 0.2 }}
            className="bg-background"
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
            <Controls showInteractive={false} />
            <MiniMap
              nodeColor={(node) => {
                switch (node.type) {
                  case "treasury":
                    return "var(--color-ceiling)";
                  case "agent":
                    return "var(--color-primary)";
                  case "action":
                    return "var(--color-accent)";
                  default:
                    return "var(--color-border-strong)";
                }
              }}
              maskColor="rgb(8 8 10 / 0.75)"
              className="!bottom-4 !right-4"
            />
          </ReactFlow>
        </div>
      </div>

      {editingWorkflow && (
        <EditWorkflowDialog
          key={workflow.id}
          workflow={workflow}
          open
          onOpenChange={(open) => !open && setEditingWorkflow(false)}
        />
      )}
      {editingAgent && (
        <AgentSettingsSheet
          key={editingAgent.id}
          agent={editingAgent}
          workflow={workflow}
          open
          onOpenChange={(open) => !open && setEditingAgent(null)}
        />
      )}
      <CreateAgentDialog
        open={creatingAgent}
        onOpenChange={setCreatingAgent}
        workflows={workflows}
        defaultWorkflowId={workflow.id}
      />
      {editingAction && (
        <ActionNodeDialog
          key={editingAction.id}
          mcp={editingAction}
          open
          onOpenChange={(open) => !open && setEditingAction(null)}
        />
      )}
    </div>
  );
}

export function WorkflowCanvas({ workflowId }: { workflowId: string }) {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner workflowId={workflowId} />
    </ReactFlowProvider>
  );
}
