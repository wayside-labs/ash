"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { CanvasSnapshot } from "@/components/flow/canvas-utils";
import { cloneSnapshot } from "@/components/flow/canvas-utils";

const MAX_HISTORY = 50;

type WorkflowHistory = {
  past: CanvasSnapshot[];
  present: CanvasSnapshot;
  future: CanvasSnapshot[];
};

type WorkflowCanvasStore = {
  byWorkflow: Record<string, WorkflowHistory>;
  hasHydrated: boolean;

  setHasHydrated: (hydrated: boolean) => void;
  initWorkflow: (workflowId: string, initial: CanvasSnapshot) => CanvasSnapshot;
  getSnapshot: (workflowId: string) => CanvasSnapshot | null;
  replaceSnapshot: (
    workflowId: string,
    snapshot: CanvasSnapshot,
    options?: { recordHistory?: boolean },
  ) => CanvasSnapshot;
  undo: (workflowId: string) => CanvasSnapshot | null;
  redo: (workflowId: string) => CanvasSnapshot | null;
  canUndo: (workflowId: string) => boolean;
  canRedo: (workflowId: string) => boolean;
};

function trimPast(past: CanvasSnapshot[]): CanvasSnapshot[] {
  if (past.length <= MAX_HISTORY) return past;
  return past.slice(past.length - MAX_HISTORY);
}

export const useWorkflowCanvasStore = create<WorkflowCanvasStore>()(
  persist(
    (set, get) => ({
      byWorkflow: {},
      hasHydrated: false,

      setHasHydrated: (hasHydrated) => set({ hasHydrated }),

      initWorkflow: (workflowId, initial) => {
        const existing = get().byWorkflow[workflowId];
        if (existing) return cloneSnapshot(existing.present);

        const present = cloneSnapshot(initial);
        set((state) => ({
          byWorkflow: {
            ...state.byWorkflow,
            [workflowId]: { past: [], present, future: [] },
          },
        }));
        return present;
      },

      getSnapshot: (workflowId) => {
        const entry = get().byWorkflow[workflowId];
        return entry ? cloneSnapshot(entry.present) : null;
      },

      replaceSnapshot: (workflowId, snapshot, options) => {
        const recordHistory = options?.recordHistory ?? true;
        const next = cloneSnapshot(snapshot);

        set((state) => {
          const current = state.byWorkflow[workflowId];
          if (!current) {
            return {
              byWorkflow: {
                ...state.byWorkflow,
                [workflowId]: { past: [], present: next, future: [] },
              },
            };
          }

          if (!recordHistory) {
            return {
              byWorkflow: {
                ...state.byWorkflow,
                [workflowId]: { ...current, present: next },
              },
            };
          }

          return {
            byWorkflow: {
              ...state.byWorkflow,
              [workflowId]: {
                past: trimPast([...current.past, cloneSnapshot(current.present)]),
                present: next,
                future: [],
              },
            },
          };
        });

        return next;
      },

      undo: (workflowId) => {
        const entry = get().byWorkflow[workflowId];
        if (!entry || entry.past.length === 0) return null;

        const previous = entry.past.at(-1);
        if (!previous) return null;

        const nextPresent = cloneSnapshot(previous);
        set((state) => ({
          byWorkflow: {
            ...state.byWorkflow,
            [workflowId]: {
              past: entry.past.slice(0, -1),
              present: nextPresent,
              future: [cloneSnapshot(entry.present), ...entry.future],
            },
          },
        }));

        return nextPresent;
      },

      redo: (workflowId) => {
        const entry = get().byWorkflow[workflowId];
        if (!entry || entry.future.length === 0) return null;

        const next = entry.future[0];
        if (!next) return null;

        const nextPresent = cloneSnapshot(next);
        set((state) => ({
          byWorkflow: {
            ...state.byWorkflow,
            [workflowId]: {
              past: trimPast([...entry.past, cloneSnapshot(entry.present)]),
              present: nextPresent,
              future: entry.future.slice(1),
            },
          },
        }));

        return nextPresent;
      },

      canUndo: (workflowId) => (get().byWorkflow[workflowId]?.past.length ?? 0) > 0,
      canRedo: (workflowId) => (get().byWorkflow[workflowId]?.future.length ?? 0) > 0,
    }),
    {
      name: "agent-rails-workflow-canvas",
      partialize: (state) => ({ byWorkflow: state.byWorkflow }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
