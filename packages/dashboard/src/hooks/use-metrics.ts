"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { DestinationContact, MetricsPeriod, MetricsSummary } from "@/lib/metrics/schema";
import type { Workflow } from "@/lib/types";
import { useAppStore } from "@/stores/app-store";

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export type MetricsScopeInput = {
  workflowId: string | null;
  agentId: string | null;
  mint: string | null;
};

/**
 * Which treasuries and sessions a scope resolves to.
 *
 * Demo workflows carry no `treasuryAddress`, so they drop out here rather than
 * needing to be filtered downstream — which is also why no demo figure can ever
 * reach an on-chain total.
 */
export function resolveScope(
  workflows: Workflow[],
  scope: MetricsScopeInput,
): { treasuries: string[]; sessions: string[] } {
  const inScope = scope.workflowId ? workflows.filter((w) => w.id === scope.workflowId) : workflows;

  const treasuries = [
    ...new Set(inScope.map((w) => w.treasuryAddress).filter((a): a is string => Boolean(a))),
  ];

  // Only an agent-scoped view narrows to sessions. An empty list would mean
  // "no sessions", which is a different claim from "every session".
  const sessions = scope.agentId
    ? [
        ...new Set(
          inScope
            .flatMap((w) => w.agents)
            .filter((agent) => agent.id === scope.agentId)
            .map((agent) => agent.resolvedSessionAddress)
            .filter((a): a is string => Boolean(a)),
        ),
      ]
    : [];

  return { treasuries, sessions };
}

export function useMetricsSummary(input: {
  treasuries: string[];
  sessions: string[];
  period: MetricsPeriod;
  scope: MetricsScopeInput;
}) {
  const { cluster, customRpc } = useAppStore();
  const treasuries = useMemo(() => [...input.treasuries].sort(), [input.treasuries]);
  const sessions = useMemo(() => [...input.sessions].sort(), [input.sessions]);

  const params = new URLSearchParams({ cluster, period: input.period });
  if (customRpc) params.set("rpc", customRpc);
  if (treasuries.length > 0) params.set("treasuries", treasuries.join(","));
  if (sessions.length > 0) params.set("sessions", sessions.join(","));
  if (input.scope.workflowId) params.set("workflowId", input.scope.workflowId);
  if (input.scope.agentId) params.set("agentId", input.scope.agentId);
  if (input.scope.mint) params.set("mint", input.scope.mint);

  return useQuery({
    queryKey: [
      "metrics-summary",
      cluster,
      customRpc,
      treasuries,
      sessions,
      input.period,
      input.scope.workflowId,
      input.scope.agentId,
      input.scope.mint,
    ],
    enabled: treasuries.length > 0,
    // The same clock as useVaultBalances, so two widgets on one screen cannot
    // disagree about what the vault holds.
    staleTime: 30_000,
    refetchInterval: 30_000,
    placeholderData: (previous) => previous,
    queryFn: () => request<MetricsSummary>(`/api/metrics/summary?${params}`),
  });
}

/** The allowlist roster for one policy. Exact, and independent of history. */
export function useDestinationContacts(policy: string | null) {
  const { cluster, customRpc } = useAppStore();
  const params = new URLSearchParams({ cluster });
  if (customRpc) params.set("rpc", customRpc);
  if (policy) params.set("policy", policy);

  return useQuery({
    queryKey: ["metrics-destinations", cluster, customRpc, policy],
    enabled: Boolean(policy),
    staleTime: 60_000,
    placeholderData: (previous) => previous,
    queryFn: () =>
      request<{ contacts: DestinationContact[] }>(`/api/metrics/destinations?${params}`),
  });
}
