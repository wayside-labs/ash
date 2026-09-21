"use client";

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "@/i18n/locale-provider";
import {
  isPayingAgent,
  resolveAgentSessionAddress,
  resolveAgentSigningKey,
} from "@/lib/agent-wallet";
import { runnerConfigFilename } from "@/lib/mcp-config";
import type { ResourceName, SolanaCluster } from "@/lib/schema";
import type { MaskedState } from "@/lib/server/present";
import type { SolPrice } from "@/lib/server/price";
import type {
  BalanceResult,
  BuiltTransaction,
  ConfirmationResult,
  TreasuryView,
  VaultBalance,
  VaultBalances,
  VaultTransferKind,
} from "@/lib/server/solana";
import { getConnectedProvider, signAndSendTransaction } from "@/lib/solana";
import type { Agent, Money, WalletInfo, Workflow } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

const LAMPORTS_PER_SOL = 1_000_000_000;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function useDashboardState() {
  return useQuery({
    queryKey: ["state"],
    queryFn: () => request<MaskedState>("/api/state"),
    staleTime: 60_000,
    placeholderData: (previousData) => previousData,
  });
}

/** Every mutation writes the server's fresh state straight into the cache. */
function useStateMutation<TVars>(fn: (vars: TVars) => Promise<MaskedState>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (state) => queryClient.setQueryData(["state"], state),
  });
}

export function useCreateResource(resource: ResourceName) {
  return useStateMutation(async (body: Record<string, unknown>) => {
    const res = await request<{ state: MaskedState }>(`/api/state/${resource}`, {
      method: "POST",
      body: JSON.stringify(body),
    });
    return res.state;
  });
}

export function useUpdateResource(resource: ResourceName) {
  return useStateMutation(({ id, ...patch }: { id: string } & Record<string, unknown>) =>
    request<MaskedState>(`/api/state/${resource}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  );
}

export function useDeleteResource(resource: ResourceName) {
  return useStateMutation((id: string) =>
    request<MaskedState>(`/api/state/${resource}/${id}`, { method: "DELETE" }),
  );
}

/**
 * Downloads the workflow's `.mcp.json`. The body is fetched as an opaque blob
 * rather than parsed: it is the only response that carries unmasked env values,
 * so it goes straight from the network to the user's disk. The counts come back
 * in headers so the toast can say what was compiled.
 */
export function useExportRunnerConfig() {
  return useMutation({
    mutationFn: async (workflow: { id: string; name: string }) => {
      const res = await fetch(
        `/api/export/runner-config?workflowId=${encodeURIComponent(workflow.id)}`,
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const servers = Number(res.headers.get("X-Runner-Servers") ?? 0);
      const skipped = Number(res.headers.get("X-Runner-Skipped") ?? 0);

      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = runnerConfigFilename(workflow.name);
      a.click();
      URL.revokeObjectURL(url);

      return { servers, skipped };
    },
  });
}

export function useUpdateProfile() {
  return useStateMutation((profile: Record<string, unknown>) =>
    request<MaskedState>("/api/state", {
      method: "PATCH",
      body: JSON.stringify({ profile }),
    }),
  );
}

export function useUpdateSettings() {
  return useStateMutation((settings: Record<string, unknown>) =>
    request<MaskedState>("/api/state", {
      method: "PATCH",
      body: JSON.stringify({ settings }),
    }),
  );
}

export function useResetState() {
  return useStateMutation(() => request<MaskedState>("/api/state", { method: "DELETE" }));
}

/** SOL balances for every real address the dashboard knows about. */
export function useBalances(addresses: (string | null | undefined)[]) {
  const { cluster, customRpc } = useAppStore();
  const wanted = useMemo(
    () => [...new Set(addresses.filter((a): a is string => Boolean(a)))].sort(),
    [addresses],
  );

  const query = useQuery({
    queryKey: ["balances", cluster, customRpc, wanted],
    enabled: wanted.length > 0,
    staleTime: 30_000,
    refetchInterval: 30_000,
    placeholderData: (previousData) => previousData,
    queryFn: () =>
      request<{ balances: BalanceResult[] }>("/api/solana/balances", {
        method: "POST",
        body: JSON.stringify({ cluster, rpc: customRpc || null, addresses: wanted }),
      }),
  });

  const byAddress = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of query.data?.balances ?? []) {
      if (row.lamports !== null) map.set(row.address, row.lamports);
    }
    return map;
  }, [query.data]);

  return { ...query, byAddress };
}

/** Spot SOL/USD, shared by the header ticker and every chain `Money.usd`. */
export function useSolPrice() {
  return useQuery({
    queryKey: ["sol-price"],
    queryFn: () => request<SolPrice>("/api/solana/price"),
    staleTime: 15_000,
    refetchInterval: 15_000,
    placeholderData: (previousData) => previousData,
  });
}

/** Resolves each treasury's sol_vault PDA and its balance — where the SOL is. */
export function useVaultBalances(treasuries: (string | null | undefined)[]) {
  const { cluster, customRpc } = useAppStore();
  const wanted = useMemo(
    () => [...new Set(treasuries.filter((t): t is string => Boolean(t)))].sort(),
    [treasuries],
  );

  const query = useQuery({
    queryKey: ["vault-balances", cluster, customRpc, wanted],
    enabled: wanted.length > 0,
    staleTime: 30_000,
    refetchInterval: 30_000,
    placeholderData: (previousData) => previousData,
    queryFn: () =>
      request<VaultBalances>("/api/solana/vault-balances", {
        method: "POST",
        body: JSON.stringify({ cluster, rpc: customRpc || null, treasuries: wanted }),
      }),
  });

  const rows = useMemo(
    () => (Array.isArray(query.data?.vaults) ? query.data.vaults : []),
    [query.data],
  );

  const byTreasury = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.lamports !== null) map.set(row.treasury, row.lamports);
    }
    return map;
  }, [rows]);

  /** Full row — the vault PDA and on-chain owner the deposit/withdraw flow needs. */
  const vaultByTreasury = useMemo(() => {
    const map = new Map<string, VaultBalance>();
    for (const row of rows) map.set(row.treasury, row);
    return map;
  }, [rows]);

  return {
    ...query,
    byTreasury,
    vaultByTreasury,
    rentExemptMinimum: query.data?.rentExemptMinimum ?? 0,
  };
}

export function useTreasury(address: string | null) {
  const { cluster, customRpc } = useAppStore();
  return useQuery({
    queryKey: ["treasury", cluster, customRpc, address],
    enabled: Boolean(address),
    staleTime: 60_000,
    placeholderData: (previousData) => previousData,
    queryFn: () => fetchTreasuryView(cluster, customRpc, address as string),
  });
}

function fetchTreasuryView(cluster: SolanaCluster, customRpc: string, address: string) {
  const params = new URLSearchParams({ cluster, address });
  if (customRpc) params.set("rpc", customRpc);
  return request<TreasuryView>(`/api/solana/treasury?${params}`);
}

/** One treasury read per vault — used to resolve session_key → agent name. */
function useTreasuryMap(addresses: string[], enabled: boolean) {
  const { cluster, customRpc } = useAppStore();
  const unique = useMemo(() => [...new Set(addresses.filter(Boolean))], [addresses]);
  const queries = useQueries({
    queries: unique.map((address) => ({
      queryKey: ["treasury", cluster, customRpc, address],
      queryFn: () => fetchTreasuryView(cluster, customRpc, address),
      staleTime: 60_000,
      enabled: enabled && Boolean(address),
    })),
  });
  return useMemo(() => {
    const map = new Map<string, TreasuryView>();
    for (let i = 0; i < unique.length; i++) {
      const view = queries[i]?.data;
      const addr = unique[i];
      if (view && addr) map.set(addr, view);
    }
    return map;
  }, [unique, queries]);
}

export type VaultTransferInput = {
  kind: VaultTransferKind;
  treasury: string;
  lamports: bigint;
};

export type VaultTransferResult = {
  signature: string;
  status: ConfirmationResult["status"];
};

/**
 * Build on the server, sign in the wallet, confirm on the server. The signing
 * step is the only part that cannot move behind the API, because the key lives
 * in the extension — so the browser never needs an RPC of its own and the
 * custom-RPC allowlist stays enforceable.
 */
export function useVaultTransfer() {
  const { cluster, customRpc, walletAddress } = useAppStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async ({ kind, treasury, lamports }: VaultTransferInput) => {
      const provider = getConnectedProvider(walletAddress);
      if (!walletAddress || !provider) throw new Error(t("vaultTransfer.error.walletNotConnected"));

      const built = await request<BuiltTransaction>("/api/solana/vault-transfer", {
        method: "POST",
        body: JSON.stringify({
          cluster,
          rpc: customRpc || null,
          kind,
          treasury,
          wallet: walletAddress,
          lamports: lamports.toString(),
        }),
      });

      let signature: string;
      try {
        signature = await signAndSendTransaction(provider, built.transaction);
      } catch (error) {
        throw new Error(describeWalletError(error, t));
      }

      const confirmation = await request<ConfirmationResult>("/api/solana/confirm", {
        method: "POST",
        body: JSON.stringify({ cluster, rpc: customRpc || null, signature }),
      });
      if (confirmation.status === "failed") {
        throw new Error(
          t("vaultTransfer.error.rejectedOnChain", { detail: confirmation.error ?? "" }),
        );
      }
      return { signature, status: confirmation.status } satisfies VaultTransferResult;
    },
    onSuccess: () => {
      // The vault, the wallet that funded it, and any open treasury drawer all
      // moved — refetch rather than patch, since the amounts are on-chain truth.
      for (const key of ["vault-balances", "balances", "treasury"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

/** Wallet rejections are routine, not failures worth a stack trace. */
function describeWalletError(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "WALLET_CANNOT_SIGN") return t("vaultTransfer.error.walletCannotSign");
  if (/user rejected|denied|cancel/i.test(message)) return t("vaultTransfer.error.rejected");
  return message;
}

export type ProviderStatus = {
  id: "claude-cli" | "anthropic-api" | "demo";
  label: string;
  available: boolean;
  detail: string;
  models: { id: string; label: string }[];
};

/** What this machine can actually run the chat on. */
export function useChatProviders() {
  const { data: state } = useDashboardState();
  const locale = state?.settings.language ?? "en";
  return useQuery({
    queryKey: ["chat-providers", locale],
    queryFn: () => request<{ providers: ProviderStatus[] }>("/api/chat/providers"),
    staleTime: 60_000,
  });
}

export function useRpcHealth() {
  return useMutation({
    mutationFn: (vars: { cluster: SolanaCluster; rpc: string | null }) =>
      request<{ ok: boolean; detail: string; url: string }>("/api/solana/rpc-health", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
  });
}

function money(
  lamports: number | undefined,
  demoUsd: number | null,
  isDemo: boolean,
  solPriceUsd: number | null,
): Money {
  if (lamports !== undefined) {
    const sol = lamports / LAMPORTS_PER_SOL;
    return { kind: "chain", sol, usd: solPriceUsd === null ? null : sol * solPriceUsd };
  }
  if (isDemo && demoUsd !== null) return { kind: "demo", usd: demoUsd };
  return { kind: "unknown" };
}

export type UseWorkflowsOptions = {
  /** When false, skip on-chain balance reads — faster for agents/limits. Default true. */
  withChain?: boolean;
};

/**
 * The composed view every page renders: stored rows joined with whatever the
 * RPC could resolve. Rows without a real address stay `unknown` rather than
 * borrowing a number from somewhere else.
 */
export function useWorkflows(options: UseWorkflowsOptions = {}) {
  const withChain = options.withChain ?? true;
  const state = useDashboardState();
  const { walletAddress } = useAppStore();
  const { data: price } = useSolPrice();
  const solPriceUsd = withChain ? (price?.usd ?? null) : null;

  const treasuryAddresses = useMemo(
    () => (withChain ? (state.data?.workflows ?? []).map((w) => w.treasuryAddress) : []),
    [state.data, withChain],
  );
  const treasuryMap = useTreasuryMap(
    treasuryAddresses.filter((a): a is string => Boolean(a)),
    withChain,
  );

  const addresses = useMemo(() => {
    if (!withChain) return [];
    const rows = state.data;
    if (!rows) return [];
    const keys = rows.agents.flatMap((agent) => {
      const workflow = rows.workflows.find((w) => w.id === agent.workflowId);
      const sessions = workflow?.treasuryAddress
        ? treasuryMap.get(workflow.treasuryAddress)?.sessions
        : undefined;
      const key = resolveAgentSigningKey(agent, sessions);
      return key ? [key] : [];
    });
    return [...keys, walletAddress];
  }, [state.data, walletAddress, withChain, treasuryMap]);

  const balances = useBalances(addresses);
  const vaults = useVaultBalances(
    useMemo(() => treasuryAddresses.filter((a): a is string => Boolean(a)), [treasuryAddresses]),
  );

  const workflows = useMemo<Workflow[]>(() => {
    const rows = state.data;
    if (!rows) return [];
    return rows.workflows.map((workflow) => {
      const sessions = workflow.treasuryAddress
        ? treasuryMap.get(workflow.treasuryAddress)?.sessions
        : undefined;
      const agents: Agent[] = rows.agents
        .filter((agent) => agent.workflowId === workflow.id)
        .map((agent) => {
          const signingKey = withChain
            ? resolveAgentSigningKey(agent, sessions)
            : agent.walletAddress;
          const resolvedSessionAddress = withChain
            ? resolveAgentSessionAddress(agent, sessions)
            : agent.sessionAddress;
          return {
            ...agent,
            workflowName: workflow.name,
            spentUsd: agent.demo ? agent.demoSpentUsd : null,
            signingKey,
            resolvedSessionAddress,
            signingKeyFromChain: withChain && !agent.walletAddress && Boolean(signingKey),
            balance: money(
              signingKey ? balances.byAddress.get(signingKey) : undefined,
              agent.demoBalanceUsd,
              agent.demo,
              solPriceUsd,
            ),
          };
        });
      return {
        ...workflow,
        agents,
        balance: money(
          workflow.treasuryAddress ? vaults.byTreasury.get(workflow.treasuryAddress) : undefined,
          workflow.demoBalanceUsd,
          workflow.demo,
          solPriceUsd,
        ),
      };
    });
  }, [state.data, balances.byAddress, vaults.byTreasury, solPriceUsd, treasuryMap, withChain]);

  return {
    workflows,
    isLoading: state.isPending && !state.data,
    error: state.error,
    balances,
    vaults,
  };
}

export function useWallets(): { wallets: WalletInfo[]; isLoading: boolean } {
  const { workflows, isLoading, balances } = useWorkflows();
  const { walletAddress, walletName } = useAppStore();
  const { data: price } = useSolPrice();
  const solPriceUsd = price?.usd ?? null;

  const wallets = useMemo<WalletInfo[]>(() => {
    const rows: WalletInfo[] = [];

    for (const workflow of workflows) {
      rows.push({
        id: `t_${workflow.id}`,
        address: workflow.treasuryAddress,
        type: "treasury",
        balance: workflow.balance,
        workflowId: workflow.id,
        workflowName: workflow.name,
      });
      for (const agent of workflow.agents) {
        if (!isPayingAgent(agent) && !agent.signingKey) continue;
        rows.push({
          id: `a_${agent.id}`,
          address: agent.signingKey,
          type: "agent",
          balance: agent.balance,
          workflowId: workflow.id,
          workflowName: workflow.name,
          agentId: agent.id,
          agentName: agent.name,
          agentRole: agent.role,
          dailyLimitUsd: agent.dailyLimitUsd,
          dailySpentUsd: agent.spentUsd,
        });
      }
    }

    if (walletAddress) {
      const lamports = balances.byAddress.get(walletAddress);
      rows.push({
        id: "owner",
        address: walletAddress,
        type: "owner",
        balance:
          lamports === undefined
            ? { kind: "unknown" }
            : {
                kind: "chain",
                sol: lamports / LAMPORTS_PER_SOL,
                usd: solPriceUsd === null ? null : (lamports / LAMPORTS_PER_SOL) * solPriceUsd,
              },
        workflowId: "",
        workflowName: "",
        ownerWalletName: walletName,
      });
    }

    return rows;
  }, [workflows, walletAddress, walletName, balances.byAddress, solPriceUsd]);

  return { wallets, isLoading };
}
