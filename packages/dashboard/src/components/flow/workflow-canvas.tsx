"use client";

import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  MiniMap,
  type Node,
  type NodeChange,
  type NodeMouseHandler,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Redo2, Sparkles, Undo2, Wand2 } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyBlueprintWithMagicFix,
  buildInitialGraph,
  type CanvasSnapshot,
  nodeId,
  parseAIBlueprintInput,
  refreshNodeEntityData,
  simulateMagicFix,
} from "@/components/flow/canvas-utils";
import { NodePalette, readPaletteDragPayload } from "@/components/flow/node-palette";
import { flowNodeTypes } from "@/components/flow/node-types";
import type { AIGraphBlueprint, FlowNodeData } from "@/components/flow/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { AgentSettingsSheet } from "@/components/workflows/agent-settings-sheet";
import { CreateAgentDialog, EditWorkflowDialog } from "@/components/workflows/workflow-dialogs";
import "@/components/flow/flow-theme.css";
import { useDashboardState, useTreasury, useWorkflows } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { CANVAS_BLUEPRINT_EVENT } from "@/lib/canvas-blueprint-bridge";
import type { Agent, McpServer } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";
import { useBlueprintStore } from "@/stores/blueprint-store";
import { useWorkflowCanvasStore } from "@/stores/workflow-canvas-store";
import { ActionNodeDialog } from "./action-node-dialog";

function WorkflowCanvasInner({ workflowId }: { workflowId: string }) {
  const { t } = useTranslation();
  const hidden = useBalancesHidden();
  const toast = useToast();
  const { workflows } = useWorkflows();
  const state = useDashboardState();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const canvasHasHydrated = useWorkflowCanvasStore((store) => store.hasHydrated);
  const canUndo = useWorkflowCanvasStore(
    (store) => (store.byWorkflow[workflowId]?.past.length ?? 0) > 0,
  );
  const canRedo = useWorkflowCanvasStore(
    (store) => (store.byWorkflow[workflowId]?.future.length ?? 0) > 0,
  );

  const workflow = workflows.find((row) => row.id === workflowId);
  const mcps = state.data?.mcps ?? [];
  const { data: treasuryView } = useTreasury(workflow?.treasuryAddress ?? null);

  const seedGraph = useMemo(() => {
    if (!workflow) return { nodes: [] as Node<FlowNodeData>[], edges: [] as Edge[] };
    return buildInitialGraph(workflow, mcps, hidden, treasuryView);
  }, [workflow, mcps, hidden, treasuryView]);

  const [nodes, setNodes] = useState<Node<FlowNodeData>[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const graphRef = useRef<CanvasSnapshot>({ nodes: [], edges: [] });
  const [hydrated, setHydrated] = useState(false);
  const [blueprintInput, setBlueprintInput] = useState("");
  const [editingWorkflow, setEditingWorkflow] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [editingAction, setEditingAction] = useState<McpServer | null>(null);

  const applySnapshot = useCallback(
    (snapshot: CanvasSnapshot, options?: { recordHistory?: boolean }) => {
      const next = useWorkflowCanvasStore.getState().replaceSnapshot(workflowId, snapshot, options);
      graphRef.current = next;
      setNodes(next.nodes);
      setEdges(next.edges);
      return next;
    },
    [workflowId],
  );

  const commitSnapshot = useCallback(
    (snapshot: CanvasSnapshot) => applySnapshot(snapshot, { recordHistory: true }),
    [applySnapshot],
  );

  useEffect(() => {
    graphRef.current = { nodes, edges };
  }, [nodes, edges]);

  useEffect(() => {
    if (!workflow || !canvasHasHydrated || hydrated) return;

    const persisted = useWorkflowCanvasStore.getState().initWorkflow(workflowId, seedGraph);
    const refreshed = {
      nodes: refreshNodeEntityData(persisted.nodes, workflow, mcps, hidden, treasuryView),
      edges: persisted.edges,
    };
    applySnapshot(refreshed, { recordHistory: false });
    setHydrated(true);
  }, [
    applySnapshot,
    canvasHasHydrated,
    hidden,
    hydrated,
    mcps,
    seedGraph,
    treasuryView,
    workflow,
    workflowId,
  ]);

  useEffect(() => {
    if (!workflow || !hydrated) return;
    setNodes((current) => {
      const refreshed = refreshNodeEntityData(current, workflow, mcps, hidden, treasuryView);
      const nextSnapshot = { nodes: refreshed, edges: graphRef.current.edges };
      graphRef.current = nextSnapshot;
      useWorkflowCanvasStore.getState().replaceSnapshot(workflowId, nextSnapshot, {
        recordHistory: false,
      });
      return refreshed;
    });
  }, [workflow, mcps, hidden, treasuryView, hydrated, workflowId]);

  const onNodesChange = useCallback(
    (changes: NodeChange<Node<FlowNodeData>>[]) => {
      if (!hydrated) return;
      setNodes((currentNodes) => {
        const nextNodes = applyNodeChanges(changes, currentNodes);
        const nextSnapshot = { nodes: nextNodes, edges: graphRef.current.edges };
        graphRef.current = nextSnapshot;
        useWorkflowCanvasStore.getState().replaceSnapshot(workflowId, nextSnapshot, {
          recordHistory: false,
        });
        return nextNodes;
      });
    },
    [hydrated, workflowId],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      if (!hydrated) return;
      setEdges((currentEdges) => {
        const nextEdges = applyEdgeChanges(changes, currentEdges);
        const nextSnapshot = { nodes: graphRef.current.nodes, edges: nextEdges };
        graphRef.current = nextSnapshot;
        useWorkflowCanvasStore.getState().replaceSnapshot(workflowId, nextSnapshot, {
          recordHistory: false,
        });
        return nextEdges;
      });
    },
    [hydrated, workflowId],
  );

  const onNodeDragStop = useCallback(() => {
    commitSnapshot(graphRef.current);
  }, [commitSnapshot]);

  const onBeforeDelete = useCallback(async () => {
    commitSnapshot(graphRef.current);
    return true;
  }, [commitSnapshot]);

  const onConnect = useCallback(
    (connection: Connection) => {
      const current = graphRef.current;
      commitSnapshot({
        nodes: current.nodes,
        edges: addEdge({ ...connection, animated: false }, current.edges),
      });
    },
    [commitSnapshot],
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

      const current = graphRef.current;
      commitSnapshot({
        nodes: current.nodes.concat({
          id,
          type: payload.type,
          position,
          data: payload.data,
        }),
        edges: current.edges,
      });
    },
    [commitSnapshot, screenToFlowPosition],
  );

  const handleAIGraphGeneration = useCallback(
    (blueprint: AIGraphBlueprint) => {
      if (!blueprint.nodes.length && !blueprint.edges.length) return;

      const current = graphRef.current;
      commitSnapshot(applyBlueprintWithMagicFix(current.nodes, current.edges, blueprint));
      toast(t("flowCanvas.ai.generated"));
      setBlueprintInput("");
      requestAnimationFrame(() => {
        fitView({ padding: 0.2, duration: 450 });
      });
    },
    [commitSnapshot, fitView, t, toast],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onBlueprint = (event: Event) => {
      const detail = (event as CustomEvent<AIGraphBlueprint & { workflowId?: string }>).detail;
      if (!detail || (detail.workflowId && detail.workflowId !== workflowId)) return;
      handleAIGraphGeneration({ nodes: detail.nodes ?? [], edges: detail.edges ?? [] });
    };

    window.addEventListener(CANVAS_BLUEPRINT_EVENT, onBlueprint);
    return () => window.removeEventListener(CANVAS_BLUEPRINT_EVENT, onBlueprint);
  }, [handleAIGraphGeneration, workflowId]);

  useEffect(() => {
    if (!hydrated || !workflow) return;
    const pending = useBlueprintStore.getState().takePending(workflowId);
    if (!pending) return;
    handleAIGraphGeneration({ nodes: pending.nodes, edges: pending.edges });
  }, [handleAIGraphGeneration, hydrated, workflow, workflowId]);

  const handleBlueprintSubmit = useCallback(
    (raw: string) => {
      const blueprint = parseAIBlueprintInput(raw);
      if (!blueprint) {
        toast(t("flowCanvas.ai.invalidBlueprint"));
        return;
      }
      handleAIGraphGeneration(blueprint);
    },
    [handleAIGraphGeneration, t, toast],
  );

  const handleUndo = useCallback(() => {
    const snapshot = useWorkflowCanvasStore.getState().undo(workflowId);
    if (!snapshot || !workflow) return;
    const refreshed = {
      nodes: refreshNodeEntityData(snapshot.nodes, workflow, mcps, hidden, treasuryView),
      edges: snapshot.edges,
    };
    graphRef.current = refreshed;
    setNodes(refreshed.nodes);
    setEdges(refreshed.edges);
    useWorkflowCanvasStore
      .getState()
      .replaceSnapshot(workflowId, refreshed, { recordHistory: false });
  }, [hidden, mcps, treasuryView, workflow, workflowId]);

  const handleRedo = useCallback(() => {
    const snapshot = useWorkflowCanvasStore.getState().redo(workflowId);
    if (!snapshot || !workflow) return;
    const refreshed = {
      nodes: refreshNodeEntityData(snapshot.nodes, workflow, mcps, hidden, treasuryView),
      edges: snapshot.edges,
    };
    graphRef.current = refreshed;
    setNodes(refreshed.nodes);
    setEdges(refreshed.edges);
    useWorkflowCanvasStore
      .getState()
      .replaceSnapshot(workflowId, refreshed, { recordHistory: false });
  }, [hidden, mcps, treasuryView, workflow, workflowId]);

  const runMagicFix = useCallback(() => {
    const current = graphRef.current;
    commitSnapshot({
      nodes: current.nodes,
      edges: simulateMagicFix(current.nodes, current.edges),
    });
    toast(t("flowCanvas.magicFix.applied"));
  }, [commitSnapshot, t, toast]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;

      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        handleUndo();
        return;
      }

      if ((event.key.toLowerCase() === "z" && event.shiftKey) || event.key.toLowerCase() === "y") {
        event.preventDefault();
        handleRedo();
      }
    };

    if (typeof window === "undefined") return;
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleRedo, handleUndo]);

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

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!canUndo}
              onClick={handleUndo}
              aria-label={t("flowCanvas.history.undo")}
            >
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={!canRedo}
              onClick={handleRedo}
              aria-label={t("flowCanvas.history.redo")}
            >
              <Redo2 className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={runMagicFix}
              className="border border-accent/20"
            >
              <Wand2 className="h-3.5 w-3.5 text-accent" />
              <span className="text-accent">{t("flowCanvas.magicFix.label")}</span>
            </Button>
          </div>

          <form
            className="flex max-w-md flex-1 items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              handleBlueprintSubmit(blueprintInput);
            }}
          >
            <Input
              value={blueprintInput}
              onChange={(event) => setBlueprintInput(event.target.value)}
              placeholder={t("flowCanvas.ai.placeholder")}
              className="h-9 text-sm"
            />
            <Button type="submit" size="sm" variant="secondary" disabled={!blueprintInput.trim()}>
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
            onNodeDragStop={onNodeDragStop}
            onBeforeDelete={onBeforeDelete}
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
            <Controls showInteractive={false} className={cn("!bottom-4 !left-4")} />
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
