"use client";

import { create } from "zustand";
import type { AIGraphBlueprint } from "@/components/flow/types";

export type PendingCanvasBlueprint = AIGraphBlueprint & {
  workflowId: string;
  title: string;
  autoMagicFix?: boolean;
};

type BlueprintStore = {
  pending: PendingCanvasBlueprint | null;
  queueBlueprint: (blueprint: PendingCanvasBlueprint) => void;
  takePending: (workflowId: string) => PendingCanvasBlueprint | null;
  clearPending: () => void;
};

export const useBlueprintStore = create<BlueprintStore>((set, get) => ({
  pending: null,

  queueBlueprint: (blueprint) => set({ pending: blueprint }),

  takePending: (workflowId) => {
    const pending = get().pending;
    if (!pending || pending.workflowId !== workflowId) return null;
    set({ pending: null });
    return pending;
  },

  clearPending: () => set({ pending: null }),
}));
