"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { OperationMode, SolanaCluster } from "@/lib/types";

interface AppState {
  cluster: SolanaCluster;
  customRpc: string;
  operationMode: OperationMode;
  walletAddress: string | null;
  walletName: string | null;
  googleEmail: string | null;
  sidebarCollapsed: boolean;
  selectedModel: string;

  setCluster: (cluster: SolanaCluster) => void;
  setCustomRpc: (rpc: string) => void;
  setOperationMode: (mode: OperationMode) => void;
  setWallet: (address: string | null, name?: string | null) => void;
  setGoogleEmail: (email: string | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSelectedModel: (model: string) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      cluster: "devnet",
      customRpc: "",
      operationMode: "native",
      walletAddress: null,
      walletName: null,
      googleEmail: null,
      // Closed by default: below lg the sidebar is an overlay drawer.
      sidebarCollapsed: true,
      // Empty means "let the server pick the best available provider".
      selectedModel: "",

      setCluster: (cluster) => set({ cluster }),
      setCustomRpc: (customRpc) => set({ customRpc }),
      setOperationMode: (operationMode) => set({ operationMode }),
      setWallet: (walletAddress, walletName = null) => set({ walletAddress, walletName }),
      setGoogleEmail: (googleEmail) => set({ googleEmail }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
    }),
    {
      name: "agent-rails-dashboard",
      partialize: (state) => ({
        cluster: state.cluster,
        customRpc: state.customRpc,
        operationMode: state.operationMode,
        selectedModel: state.selectedModel,
        googleEmail: state.googleEmail,
      }),
    },
  ),
);
