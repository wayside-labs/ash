"use client";

import {
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
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Eye, Loader2, Sparkles } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  McpPickerDialog,
  ProposalDialog,
  RemoveNodeDialog,
} from "@/components/flow/canvas-dialogs";
import { NodePalette, readPaletteDragPayload } from "@/components/flow/node-palette";
import { flowNodeTypes } from "@/components/flow/node-types";
import type { ActionNodeData, FlowNodeData, TreasuryNodeData } from "@/components/flow/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { AgentSettingsSheet } from "@/components/workflows/agent-settings-sheet";
import { CreateAgentDialog, EditWorkflowDialog } from "@/components/workflows/workflow-dialogs";
import "@/components/flow/flow-theme.css";
import {
  useCreateResource,
  useDashboardState,
  useDeleteResource,
  useImportConnector,
  useUpdateResource,
  useWorkflows,
} from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import {
  actionNodeId,
  buildGraph,
  connectChange,
  type EdgeChange,
  type GraphEdge,
  mcpsOnCanvas,
  parseNodeId,
  removeEdgeChange,
} from "@/lib/canvas-graph";
import type { ValidatedProposal } from "@/lib/canvas-proposal";
import type { WorkflowLayout } from "@/lib/schema";
import type { Agent, McpServer } from "@/lib/types";
import { formatMoney, truncateAddress } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";
import { ActionNodeDialog } from "./action-node-dialog";

type RemoveTarget = { nodeId: string; kind: "agent" | "action"; refId: string; name: string };

/**
 * The canvas is a view of rows (`lib/canvas-graph.ts`): what a node or an edge shows is an
 * agent, a payee in `paysTo`, or an MCP's scope, and editing one edits the row. Only the
 * layout — positions and hidden boxes — belongs to the canvas.
 */
function WorkflowCanvasInner({ workflowId }: { workflowId: string }) {
  const { t } = useTranslation();
  const hidden = useBalancesHidden();
  const toast = useToast();
  const { workflows } = useWorkflows();
  const state = useDashboardState();
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const updateWorkflow = useUpdateResource("workflows");
  const updateAgent = useUpdateResource("agents");
  const updateMcp = useUpdateResource("mcps");
  const updateSkill = useUpdateResource("skills");
  const createAgent = useCreateResource("agents");
  const importConnector = useImportConnector();
  const deleteAgent = useDeleteResource("agents");
  const deleteMcp = useDeleteResource("mcps");

  const workflow = workflows.find((row) => row.id === workflowId);
  const mcps = state.data?.mcps ?? [];
  const agents = useMemo(() => workflow?.agents ?? [], [workflow]);

  const graph = useMemo(
    () => (workflow ? buildGraph(workflow, agents, mcps) : { nodes: [], edges: [] }),
    [workflow, agents, mcps],
  );

  const flow = useMemo(() => {
    if (!workflow) return { nodes: [] as Node<FlowNodeData>[], edges: [] as Edge[] };
    const nodes: Node<FlowNodeData>[] = graph.nodes.flatMap((node): Node<FlowNodeData>[] => {
      if (node.kind === "treasury") {
        const data: TreasuryNodeData = {
          kind: "treasury",
          workflowId: workflow.id,
          label: workflow.name,
          balanceLabel: formatMoney(workflow.balance, hidden),
          limitLabel: agents.length > 0 ? `${agents.length} agents` : "—",
          vaultHint: workflow.treasuryAddress
            ? truncateAddress(workflow.treasuryAddress, 6)
            : undefined,
        };
        return [{ id: node.id, type: "treasury", position: node.position, data, deletable: false }];
      }
      if (node.kind === "agent") {
        const agent = agents.find((row) => row.id === node.refId);
        if (!agent) return [];
        return [
          {
            id: node.id,
            type: "agent",
            position: node.position,
            data: {
              kind: "agent",
              agentId: agent.id,
              name: agent.name,
              role: agent.role,
              status: agent.status,
            },
          },
        ];
      }
      const mcp = mcps.find((row) => row.id === node.refId);
      if (!mcp) return [];
      const data: ActionNodeData = {
        kind: "action",
        mcpId: mcp.id,
        name: mcp.name,
        provider: mcp.description || "MCP",
        enabled: mcp.enabled,
        ...(node.shared ? { shared: true } : {}),
      };
      return [{ id: node.id, type: "action", position: node.position, data }];
    });
    const edges: Edge[] = graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      deletable: edge.deletable,
      animated: edge.kind === "pays",
      data: { kind: edge.kind },
      ...(edge.kind === "tool" ? { style: { strokeDasharray: "4 4" } } : {}),
    }));
    return { nodes, edges };
  }, [workflow, graph, agents, mcps, hidden]);

  // Local copies so dragging is smooth; re-seeded whenever the rows change underneath.
  const [nodes, setNodes, onNodesChange] = useNodesState(flow.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(flow.edges);
  useEffect(() => setNodes(flow.nodes), [flow.nodes, setNodes]);
  useEffect(() => setEdges(flow.edges), [flow.edges, setEdges]);

  const [aiPrompt, setAiPrompt] = useState("");
  const [editingWorkflow, setEditingWorkflow] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [creatingAgent, setCreatingAgent] = useState(false);
  const [editingAction, setEditingAction] = useState<McpServer | null>(null);
  const [picking, setPicking] = useState(false);
  const [removing, setRemoving] = useState<RemoveTarget | null>(null);
  const [proposal, setProposal] = useState<ValidatedProposal | null>(null);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);

  const fail = useCallback(
    (error: unknown) =>
      toast(error instanceof Error ? error.message : t("common.failedToSave"), "error"),
    [t, toast],
  );

  const saveLayout = useCallback(
    (patch: Partial<WorkflowLayout>) => {
      if (!workflow) return;
      updateWorkflow.mutate(
        { id: workflow.id, layout: { ...workflow.layout, ...patch } },
        { onError: fail },
      );
    },
    [workflow, updateWorkflow, fail],
  );

  const applyChange = useCallback(
    async (change: EdgeChange) => {
      if (!workflow) return;
      switch (change.kind) {
        case "add-payee":
        case "remove-payee": {
          const agent = agents.find((row) => row.id === change.agentId);
          if (!agent) return;
          const paysTo =
            change.kind === "add-payee"
              ? [...new Set([...agent.paysTo, change.payee])]
              : agent.paysTo.filter((name) => name !== change.payee);
          await updateAgent.mutateAsync({ id: agent.id, paysTo });
          return;
        }
        case "attach-mcp":
          await updateMcp.mutateAsync({
            id: change.mcpId,
            scope: "agent",
            scopeName: change.agentName,
          });
          return;
        case "detach-mcp":
          await updateMcp.mutateAsync({
            id: change.mcpId,
            scope: "workflow",
            scopeName: change.workflowName,
          });
          return;
        case "refuse":
          toast(t(`flowCanvas.refuse.${change.reason}`), "error");
      }
    },
    [workflow, agents, updateAgent, updateMcp, toast, t],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      applyChange(connectChange(connection.source, connection.target, agents, mcps)).catch(fail);
    },
    [applyChange, agents, mcps, fail],
  );

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      if (!workflow) return;
      for (const edge of deleted) {
        const kind = (edge.data as { kind?: GraphEdge["kind"] } | undefined)?.kind;
        if (!kind) continue;
        const change = removeEdgeChange({ ...edge, kind }, workflow, agents);
        if (change) applyChange(change).catch(fail);
      }
    },
    [workflow, agents, applyChange, fail],
  );

  /** Deleting a box is never silent: ask whether to hide it or delete the row (plan D3). */
  const onBeforeDelete = useCallback(
    async ({ nodes: doomed }: { nodes: Node[]; edges: Edge[] }) => {
      const node = doomed[0];
      if (!node) return true;
      const parsed = parseNodeId(node.id);
      if (!parsed || parsed.kind === "treasury") return false;
      const name = (node.data as { name?: string }).name ?? "";
      setRemoving({ nodeId: node.id, kind: parsed.kind, refId: parsed.refId, name });
      return false;
    },
    [],
  );

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (!workflow) return;
      saveLayout({
        positions: {
          ...workflow.layout.positions,
          [node.id]: { x: Math.round(node.position.x), y: Math.round(node.position.y) },
        },
      });
    },
    [workflow, saveLayout],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const payload = readPaletteDragPayload(event);
    if (!payload) return;
    // A dropped box becomes a real row, or nothing: agents through the create dialog,
    // tools by choosing an existing MCP. There is no free-floating canvas node.
    if (payload.type === "agent") setCreatingAgent(true);
    if (payload.type === "action") setPicking(true);
  }, []);

  const onCanvas = new Set(graph.nodes.map((n) => n.id));
  const pickable = mcps.filter((mcp) => !onCanvas.has(actionNodeId(mcp.id)));

  const pickMcp = async (mcp: McpServer) => {
    if (!workflow) return;
    setPicking(false);
    try {
      const nodeKey = actionNodeId(mcp.id);
      if (workflow.layout.hidden.includes(nodeKey)) {
        saveLayout({ hidden: workflow.layout.hidden.filter((id) => id !== nodeKey) });
      }
      const inScope = mcpsOnCanvas(workflow, agents, [mcp]).length > 0;
      if (!inScope) {
        await updateMcp.mutateAsync({ id: mcp.id, scope: "workflow", scopeName: workflow.name });
      }
    } catch (error) {
      fail(error);
    }
  };

  const hideNode = () => {
    if (!workflow || !removing) return;
    saveLayout({ hidden: [...new Set([...workflow.layout.hidden, removing.nodeId])] });
    setRemoving(null);
  };

  const deleteNode = async () => {
    if (!removing) return;
    try {
      if (removing.kind === "agent") await deleteAgent.mutateAsync(removing.refId);
      else await deleteMcp.mutateAsync(removing.refId);
    } catch (error) {
      fail(error);
    }
    setRemoving(null);
  };

  const generate = async (prompt: string) => {
    if (!workflow || !prompt.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/workflows/${workflow.id}/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        proposal?: ValidatedProposal;
        error?: string;
        provider?: string;
      };
      if (res.status === 409 && body.provider === "demo") {
        toast(t("flowCanvas.ai.noModel"), "error");
        return;
      }
      if (!res.ok || !body.proposal) throw new Error(body.error ?? `${res.status}`);
      setProposal(body.proposal);
    } catch (error) {
      fail(error);
    } finally {
      setGenerating(false);
    }
  };

  /**
   * Applies an accepted proposal through the ordinary resource routes. A tool or skill the
   * proposal gives to several agents becomes workflow-scoped: scope names one agent or the
   * whole workflow, nothing in between.
   */
  const applyProposal = async () => {
    if (!workflow || !proposal) return;
    setApplying(true);
    try {
      let latest = state.data;
      for (const agent of proposal.newAgents) {
        latest = await createAgent.mutateAsync({
          name: agent.name,
          role: agent.role,
          workflowId: workflow.id,
          demo: false,
        });
      }
      const rows = (latest?.agents ?? []).filter((a) => a.workflowId === workflow.id);
      const byName = new Map(rows.map((a) => [a.name, a]));
      const payees = new Map<string, Set<string>>();
      for (const p of proposal.payees) {
        const set = payees.get(p.from) ?? new Set(byName.get(p.from)?.paysTo ?? []);
        set.add(p.to);
        payees.set(p.from, set);
      }
      for (const [name, set] of payees) {
        const agent = byName.get(name);
        if (agent) await updateAgent.mutateAsync({ id: agent.id, paysTo: [...set] });
      }
      const scopeFor = (targets: string[]) =>
        new Set(targets).size > 1
          ? { scope: "workflow", scopeName: workflow.name }
          : { scope: "agent", scopeName: targets[0] };
      const group = <T,>(items: T[], key: (i: T) => string, agentOf: (i: T) => string) => {
        const map = new Map<string, string[]>();
        for (const item of items)
          map.set(key(item), [...(map.get(key(item)) ?? []), agentOf(item)]);
        return map;
      };
      for (const [mcpId, targets] of group(
        proposal.tools,
        (x) => x.mcpId,
        (x) => x.agent,
      )) {
        await updateMcp.mutateAsync({ id: mcpId, ...scopeFor(targets) });
      }
      for (const [skillId, targets] of group(
        proposal.skills,
        (x) => x.skillId,
        (x) => x.agent,
      )) {
        await updateSkill.mutateAsync({ id: skillId, enabled: true, ...scopeFor(targets) });
      }
      // Re-validated server-side: the preview showed what the browser parsed, the route
      // decides what is written.
      for (const connector of proposal.connectors) {
        const target = scopeFor(connector.agents) as {
          scope: "workflow" | "agent";
          scopeName: string;
        };
        await importConnector.mutateAsync({ bundle: connector.bundle, ...target, enabled: true });
      }
      toast(t("flowCanvas.ai.applied"));
      setProposal(null);
      setAiPrompt("");
    } catch (error) {
      fail(error);
    } finally {
      setApplying(false);
    }
  };

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
              void generate(aiPrompt);
            }}
          >
            <Input
              value={aiPrompt}
              onChange={(event) => setAiPrompt(event.target.value)}
              placeholder={t("flowCanvas.ai.placeholder")}
              className="h-9 text-sm"
            />
            <Button
              type="submit"
              size="sm"
              variant="secondary"
              disabled={!aiPrompt.trim() || generating}
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              {t("flowCanvas.ai.generate")}
            </Button>
            {workflow.layout.hidden.length > 0 && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => saveLayout({ hidden: [] })}
              >
                <Eye className="h-3.5 w-3.5" />
                {t("flowCanvas.showHidden", { count: workflow.layout.hidden.length })}
              </Button>
            )}
          </form>
        </div>

        <div ref={reactFlowWrapper} className="relative min-h-0 flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgesDelete={onEdgesDelete}
            onBeforeDelete={onBeforeDelete}
            onNodeDragStop={onNodeDragStop}
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
      <McpPickerDialog
        open={picking}
        onOpenChange={setPicking}
        candidates={pickable}
        onPick={pickMcp}
      />
      <RemoveNodeDialog
        target={removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        onHide={hideNode}
        onDelete={deleteNode}
      />
      <ProposalDialog
        proposal={proposal}
        applying={applying}
        onOpenChange={(open) => !open && setProposal(null)}
        onApply={applyProposal}
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
