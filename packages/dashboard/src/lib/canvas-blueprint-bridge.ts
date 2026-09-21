"use client";

import type { AIGraphBlueprint } from "@/components/flow/types";
import type { PendingCanvasBlueprint } from "@/stores/blueprint-store";
import { useBlueprintStore } from "@/stores/blueprint-store";

export const CANVAS_BLUEPRINT_EVENT = "agent-rails:canvas-blueprint";

export type CanvasBlueprintEventDetail = AIGraphBlueprint & {
  workflowId: string;
};

export function canvasPathForWorkflow(workflowId: string): string {
  return `/workflows/${workflowId}/canvas`;
}

export function isActiveCanvasRoute(pathname: string, workflowId: string): boolean {
  return pathname === canvasPathForWorkflow(workflowId);
}

export function dispatchCanvasBlueprint(detail: CanvasBlueprintEventDetail): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CANVAS_BLUEPRINT_EVENT, { detail }));
}

/** Apply on the live canvas when already on route; otherwise queue + navigate. */
export function deliverCanvasBlueprint(
  blueprint: PendingCanvasBlueprint,
  ctx: { pathname: string; navigate: (href: string) => void },
): "in-place" | "navigated" {
  const target = canvasPathForWorkflow(blueprint.workflowId);

  if (isActiveCanvasRoute(ctx.pathname, blueprint.workflowId)) {
    dispatchCanvasBlueprint({
      workflowId: blueprint.workflowId,
      nodes: blueprint.nodes,
      edges: blueprint.edges,
    });
    return "in-place";
  }

  useBlueprintStore.getState().queueBlueprint(blueprint);
  ctx.navigate(target);
  return "navigated";
}
