"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Locale } from "@/i18n";
import type { OperationMode, SolanaCluster } from "@/lib/types";

export type HomePanelId = "chat" | "workflows";
export type HomeLayoutDirection = "horizontal" | "vertical";
/** The templates page: builder with a side list, or the card gallery. */
export type TemplatesView = "list" | "cards";

export const DEFAULT_HOME_LAYOUT = {
  direction: "horizontal" as HomeLayoutDirection,
  panelOrder: ["chat", "workflows"] as [HomePanelId, HomePanelId],
};

interface AppState {
  cluster: SolanaCluster;
  customRpc: string;
  operationMode: OperationMode;
  walletAddress: string | null;
  walletName: string | null;
  /** The post-login wallet offer (ADR-018) is made once, not every visit. */
  walletPromptDismissed: boolean;
  sidebarCollapsed: boolean;
  /** Desktop only: the sidebar folded away behind the header's menu button. */
  sidebarHidden: boolean;
  /** Which money dialog is open; one of them at a time, opened from anywhere. */
  moneyDialog: "deposit" | "withdraw" | null;
  /** Whether the sidebar's Advanced section is expanded. Closed for a newcomer. */
  advancedNavOpen: boolean;
  selectedModel: string;
  /** UI language — persisted so i18n does not wait on /api/state. */
  locale: Locale;
  /** Hide SOL/$ amounts in the UI. Survives reload; independent of wallet. */
  balancesHidden: boolean;
  /** False until persist rehydrates, so hidden amounts never flash. */
  hasHydrated: boolean;
  /** Home page panel order and split direction. Sizes persist via react-resizable-panels. */
  homeLayout: typeof DEFAULT_HOME_LAYOUT;
  /** Bumped on layout reset to remount panels with default sizes. */
  homeLayoutResetCounter: number;
  templatesView: TemplatesView;

  setCluster: (cluster: SolanaCluster) => void;
  setCustomRpc: (rpc: string) => void;
  setOperationMode: (mode: OperationMode) => void;
  setWallet: (address: string | null, name?: string | null) => void;
  dismissWalletPrompt: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setSidebarHidden: (hidden: boolean) => void;
  setMoneyDialog: (dialog: "deposit" | "withdraw" | null) => void;
  setAdvancedNavOpen: (open: boolean) => void;
  setSelectedModel: (model: string) => void;
  setLocale: (locale: Locale) => void;
  setBalancesHidden: (hidden: boolean) => void;
  setHasHydrated: (hydrated: boolean) => void;
  setTemplatesView: (view: TemplatesView) => void;
  swapHomePanels: () => void;
  setHomeLayoutDirection: (direction: HomeLayoutDirection) => void;
  resetHomeLayout: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      cluster: "devnet",
      customRpc: "",
      operationMode: "native",
      walletAddress: null,
      walletName: null,
      walletPromptDismissed: false,
      // Closed by default: below lg the sidebar is an overlay drawer.
      sidebarCollapsed: true,
      sidebarHidden: false,
      moneyDialog: null,
      advancedNavOpen: false,
      // Empty means "let the server pick the best available provider".
      selectedModel: "",
      locale: "en",
      balancesHidden: false,
      hasHydrated: false,
      homeLayout: DEFAULT_HOME_LAYOUT,
      homeLayoutResetCounter: 0,
      templatesView: "list",

      setCluster: (cluster) => set({ cluster }),
      setCustomRpc: (customRpc) => set({ customRpc }),
      setOperationMode: (operationMode) => set({ operationMode }),
      setWallet: (walletAddress, walletName = null) => set({ walletAddress, walletName }),
      dismissWalletPrompt: () => set({ walletPromptDismissed: true }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setSidebarHidden: (sidebarHidden) => set({ sidebarHidden }),
      setMoneyDialog: (moneyDialog) => set({ moneyDialog }),
      setAdvancedNavOpen: (advancedNavOpen) => set({ advancedNavOpen }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setLocale: (locale) => set({ locale }),
      setBalancesHidden: (balancesHidden) => set({ balancesHidden }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
      setTemplatesView: (templatesView) => set({ templatesView }),
      swapHomePanels: () =>
        set((state) => ({
          homeLayout: {
            ...state.homeLayout,
            panelOrder:
              state.homeLayout.panelOrder[0] === "chat"
                ? (["workflows", "chat"] as [HomePanelId, HomePanelId])
                : (["chat", "workflows"] as [HomePanelId, HomePanelId]),
          },
        })),
      setHomeLayoutDirection: (direction) =>
        set((state) => ({
          homeLayout: { ...state.homeLayout, direction },
        })),
      resetHomeLayout: () =>
        set((state) => ({
          homeLayout: DEFAULT_HOME_LAYOUT,
          homeLayoutResetCounter: state.homeLayoutResetCounter + 1,
        })),
    }),
    {
      name: "agent-rails-dashboard",
      partialize: (state) => ({
        cluster: state.cluster,
        customRpc: state.customRpc,
        operationMode: state.operationMode,
        selectedModel: state.selectedModel,
        locale: state.locale,
        balancesHidden: state.balancesHidden,
        walletPromptDismissed: state.walletPromptDismissed,
        advancedNavOpen: state.advancedNavOpen,
        sidebarHidden: state.sidebarHidden,
        homeLayout: state.homeLayout,
        templatesView: state.templatesView,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);

/**
 * True when amounts must not be shown: either the user hid them, or persist
 * has not finished yet (so a previously-hidden choice cannot flash).
 */
export function useBalancesHidden(): boolean {
  return useAppStore((s) => !s.hasHydrated || s.balancesHidden);
}
