"use client";

import { NATIVE_MINT } from "@agent-rails/contract/constants";
import { knownMint } from "@agent-rails/contract/mints";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { useTranslation } from "@/i18n/locale-provider";
import {
  isPayingAgent,
  resolveAgentSessionAddress,
  resolveAgentSigningKey,
} from "@/lib/agent-wallet";
import { HttpError } from "@/lib/http-error";
import { runnerBundleFilename, runnerConfigFilename } from "@/lib/mcp-config";
import type { ResourceName, SolanaCluster } from "@/lib/schema";
import type { MaskedState } from "@/lib/server/present";
import type { SolPrice } from "@/lib/server/price";
import type {
  BalanceResult,
  CreateSessionResult as BuiltCreateSession,
  BuiltTransaction,
  ConfirmationResult,
  OwnerTokenBalance,
  TreasuryView,
  VaultBalance,
  VaultBalances,
  VaultTransferKind,
} from "@/lib/server/solana";
import { getConnectedProvider, signAndSendTransaction } from "@/lib/solana";
import type { Agent, Money, VaultAsset, WalletInfo, Workflow } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

const LAMPORTS_PER_SOL = 1_000_000_000;

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new HttpError(
      res.status,
      body.error ?? null,
      body.error ?? `${res.status} ${res.statusText}`,
    );
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

export type ApplyTemplateVars = {
  templateId: string;
  workflowName: string;
  cluster: SolanaCluster;
  ownerAddress: string | null;
  treasuryAddress: string | null;
};

export type ApplyTemplateResult = {
  workflowId: string;
  setupSteps: string[];
  docsPath: string | null;
};

export function useApplyTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ApplyTemplateVars) =>
      request<ApplyTemplateResult & { state: MaskedState }>("/api/templates/apply", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (res) => queryClient.setQueryData(["state"], res.state),
  });
}

/**
 * Downloads the workflow's `.mcp.json`. The body is fetched as an opaque blob
 * rather than parsed: it is the only response that carries unmasked env values,
 * so it goes straight from the network to the user's disk. The counts come back
 * in headers so the toast can say what was compiled.
 */
export type RunnerExportTarget = {
  workflow: { id: string; name: string };
  agent?: { id: string; name: string };
  /** `zip` adds the in-scope skills as `.claude/skills/<slug>/SKILL.md`. */
  format?: "json" | "zip";
};

export function useExportRunnerConfig() {
  return useMutation({
    mutationFn: async ({ workflow, agent, format = "json" }: RunnerExportTarget) => {
      const params = new URLSearchParams({ workflowId: workflow.id, format });
      if (agent) params.set("agentId", agent.id);
      const res = await fetch(`/api/export/runner-config?${params.toString()}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `${res.status} ${res.statusText}`);
      }
      const servers = Number(res.headers.get("X-Runner-Servers") ?? 0);
      const skipped = Number(res.headers.get("X-Runner-Skipped") ?? 0);
      const skills = Number(res.headers.get("X-Runner-Skills") ?? 0);

      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download =
        format === "zip"
          ? runnerBundleFilename(workflow.name, agent?.name)
          : runnerConfigFilename(workflow.name, agent?.name);
      a.click();
      URL.revokeObjectURL(url);

      return { servers, skipped, skills };
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
    // Every upstream refusing is not fixed by asking again in 15s; back off until one answers.
    refetchInterval: (query) => (query.state.status === "error" ? 60_000 : 15_000),
    retry: false,
    placeholderData: (previousData) => previousData,
  });
}

/**
 * Each treasury's vaults: the `sol_vault` PDA and one vault ATA per configured
 * mint. The connected wallet rides along so the deposit dialog knows what the
 * owner actually holds of each mint, read on the same clock as the vault it
 * would be depositing into.
 */
export function useVaultBalances(treasuries: (string | null | undefined)[]) {
  const { cluster, customRpc, walletAddress } = useAppStore();
  const wanted = useMemo(
    () => [...new Set(treasuries.filter((t): t is string => Boolean(t)))].sort(),
    [treasuries],
  );

  const query = useQuery({
    queryKey: ["vault-balances", cluster, customRpc, wanted, walletAddress],
    enabled: wanted.length > 0,
    staleTime: 30_000,
    refetchInterval: 30_000,
    placeholderData: (previousData) => previousData,
    queryFn: () =>
      request<VaultBalances>("/api/solana/vault-balances", {
        method: "POST",
        body: JSON.stringify({
          cluster,
          rpc: customRpc || null,
          treasuries: wanted,
          owner: walletAddress || null,
        }),
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

  /** What the connected wallet holds of each mint, keyed by mint. */
  const ownerTokenByMint = useMemo(() => {
    const map = new Map<string, OwnerTokenBalance>();
    for (const row of query.data?.ownerTokens ?? []) map.set(row.mint, row);
    return map;
  }, [query.data]);

  return {
    ...query,
    byTreasury,
    vaultByTreasury,
    ownerTokenByMint,
    rentExemptMinimum: query.data?.rentExemptMinimum ?? 0,
  };
}

/**
 * Base units to a display number.
 *
 * `Number` is fine here and only here: this feeds a formatter, never a transfer
 * amount. Every transaction is built from the base-unit string the RPC returned.
 */
function toHuman(raw: string, decimals: number): number {
  const value = Number(raw) / 10 ** decimals;
  return Number.isFinite(value) ? value : 0;
}

/**
 * Turns a vault row into the assets the UI renders.
 *
 * A dollar-pegged mint is priced 1:1 rather than left blank — the alternative
 * on a stablecoin is an empty USD line next to a number that already is USD.
 * Every other token gets `null`, because guessing is worse than saying nothing.
 */
function vaultAssets(vault: VaultBalance | undefined, solPriceUsd: number | null): VaultAsset[] {
  if (!vault) return [];
  return vault.assets.map((asset) => {
    const symbol = asset.symbol ?? asset.mint.slice(0, 4);
    const amount = toHuman(asset.amount, asset.decimals);
    const money: Money =
      asset.mint === NATIVE_MINT
        ? { kind: "chain", sol: amount, usd: solPriceUsd === null ? null : amount * solPriceUsd }
        : {
            kind: "token",
            amount,
            mint: asset.mint,
            symbol,
            decimals: asset.decimals,
            usd: knownMint(asset.mint)?.stable ? amount : null,
          };
    return {
      mint: asset.mint,
      symbol,
      decimals: asset.decimals,
      raw: asset.amount,
      amount,
      money,
      vault: asset.vault,
      exists: asset.exists,
      fundingMode: asset.fundingMode,
      configured: asset.configured,
    };
  });
}

/**
 * Which asset a vault leads with.
 *
 * A treasury bootstrapped for stablecoin settlement should read as its
 * stablecoin; SOL is what pays for signatures. Only a mint we know is
 * dollar-pegged is promoted — an arbitrary SPL token in slot one is not
 * evidence that it, rather than SOL, is what the operator watches.
 */
function primaryAsset(assets: VaultAsset[]): VaultAsset | undefined {
  return (
    assets.find((asset) => asset.mint !== NATIVE_MINT && knownMint(asset.mint)?.stable) ??
    assets.find((asset) => asset.mint === NATIVE_MINT)
  );
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
  // `useQueries` returns a new `queries` array every render; depend on `data` only so
  // downstream useMemos (e.g. workflow canvas) are not reset in a setState loop.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `queries` is the unstable array this memo exists to avoid; its `data` entries are listed instead
  const treasuryViews = useMemo(
    () => unique.map((address, i) => ({ address, view: queries[i]?.data })),
    [unique, ...queries.map((query) => query.data)],
  );
  return useMemo(() => {
    const map = new Map<string, TreasuryView>();
    for (const { address, view } of treasuryViews) {
      if (view) map.set(address, view);
    }
    return map;
  }, [treasuryViews]);
}

export type VaultTransferInput = {
  kind: VaultTransferKind;
  treasury: string;
  /** The mint being moved; the native sentinel takes the SOL path. */
  mint: string;
  /** Base units of `mint` — lamports when native. */
  amount: bigint;
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
export type CreateSessionInput = {
  treasury: string;
  label: string;
  sessionKey: string;
  policy?: string | null;
  sessionTtlHours?: number;
};

export type CreateSessionMutationResult = {
  built: BuiltCreateSession;
  signature: string | null;
  status: ConfirmationResult["status"] | "skipped";
};

/**
 * Generate the session key in the browser, build on the server, sign in the
 * wallet, confirm on the server — same choreography as vault transfer.
 */
export function useCreateSession() {
  const { cluster, customRpc, walletAddress } = useAppStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async (input: CreateSessionInput): Promise<CreateSessionMutationResult> => {
      const provider = getConnectedProvider(walletAddress);
      if (!walletAddress || !provider) {
        throw new Error(t("createSession.error.walletNotConnected"));
      }

      const built = await request<BuiltCreateSession>("/api/solana/create-session", {
        method: "POST",
        body: JSON.stringify({
          cluster,
          rpc: customRpc || null,
          treasury: input.treasury,
          wallet: walletAddress,
          sessionKey: input.sessionKey,
          label: input.label,
          policy: input.policy ?? null,
          sessionTtlHours: input.sessionTtlHours ?? 24,
        }),
      });

      if (built.alreadyOnChain || !built.transaction) {
        return { built, signature: null, status: "skipped" };
      }

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
          t("createSession.error.rejectedOnChain", { detail: confirmation.error ?? "" }),
        );
      }
      return { built, signature, status: confirmation.status };
    },
    onSuccess: () => {
      for (const key of ["treasury", "vault-balances"]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

export function useVaultTransfer() {
  const { cluster, customRpc, walletAddress } = useAppStore();
  const queryClient = useQueryClient();
  const { t } = useTranslation();

  return useMutation({
    mutationFn: async ({ kind, treasury, mint, amount }: VaultTransferInput) => {
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
          mint,
          amount: amount.toString(),
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
export function describeWalletError(error: unknown, t: (key: string) => string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message === "WALLET_CANNOT_SIGN") return t("vaultTransfer.error.walletCannotSign");
  if (/user rejected|denied|cancel/i.test(message)) return t("vaultTransfer.error.rejected");
  return message;
}

export type ProviderStatus = {
  id: "claude-cli" | "anthropic-api" | "openrouter-platform" | "demo";
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
      const assets = vaultAssets(
        workflow.treasuryAddress ? vaults.vaultByTreasury.get(workflow.treasuryAddress) : undefined,
        solPriceUsd,
      );
      const primary = primaryAsset(assets);
      const solMoney = money(
        workflow.treasuryAddress ? vaults.byTreasury.get(workflow.treasuryAddress) : undefined,
        workflow.demoBalanceUsd,
        workflow.demo,
        solPriceUsd,
      );
      return {
        ...workflow,
        agents,
        assets,
        primaryMint: primary?.mint ?? null,
        solBalance: solMoney,
        // A demo row has no chain to read, so it keeps the demo figure whatever
        // the vault read returned.
        balance: primary && primary.mint !== NATIVE_MINT ? primary.money : solMoney,
      };
    });
  }, [
    state.data,
    balances.byAddress,
    vaults.byTreasury,
    vaults.vaultByTreasury,
    solPriceUsd,
    treasuryMap,
    withChain,
  ]);

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
        // Only when the headline is a token: repeating SOL under itself is noise.
        ...(workflow.balance.kind === "token" ? { secondary: workflow.solBalance } : {}),
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
