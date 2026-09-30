"use client";

import type { AgentEvent } from "@agent-rails/contract/alerts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

/** Client mirrors of `lib/server/ops/types.ts` — the server module is not importable here. */
export type ReviewView = {
  id: string;
  workflowId: string;
  kind: "payment" | "limit_increase";
  intentId: string | null;
  status: "pending" | "approved" | "rejected";
  event: AgentEvent;
  createdAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  expiresAt: string;
};

export type EventView = {
  id: string;
  workflowId: string;
  kind: AgentEvent["kind"];
  event: AgentEvent;
  receivedAt: string;
};

export type TokenView = {
  id: string;
  workflowId: string;
  createdAt: string;
  revokedAt: string | null;
  hint: string;
};

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

/** Polled: a review is only useful while the agent is still waiting on it. */
export function useReviews() {
  return useQuery({
    queryKey: ["reviews"],
    queryFn: () => json<{ reviews: ReviewView[]; now: string }>("/api/reviews"),
    refetchInterval: 15_000,
  });
}

export function useEvents() {
  return useQuery({
    queryKey: ["events"],
    queryFn: () => json<{ events: EventView[] }>("/api/events"),
    refetchInterval: 30_000,
  });
}

export function useDecideReview() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" }) =>
      json<{ review: ReviewView }>(`/api/reviews/${id}`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      }),
    onSettled: () => client.invalidateQueries({ queryKey: ["reviews"] }),
  });
}

export function useIngestTokens(workflowId: string | null) {
  return useQuery({
    queryKey: ["ingest-tokens", workflowId],
    enabled: Boolean(workflowId),
    queryFn: () =>
      json<{ ingest_url: string; tokens: TokenView[] }>(
        `/api/workflows/${workflowId}/ingest-token`,
      ),
  });
}

export function useRotateIngestToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string) =>
      json<{ id: string; token: string; ingest_url: string }>(
        `/api/workflows/${workflowId}/ingest-token`,
        { method: "POST" },
      ),
    onSettled: (_data, _error, workflowId) =>
      client.invalidateQueries({ queryKey: ["ingest-tokens", workflowId] }),
  });
}

export function useRevokeIngestToken() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, tokenId }: { workflowId: string; tokenId: string }) =>
      json<{ revoked: boolean }>(
        `/api/workflows/${workflowId}/ingest-token?tokenId=${encodeURIComponent(tokenId)}`,
        { method: "DELETE" },
      ),
    onSettled: (_data, _error, { workflowId }) =>
      client.invalidateQueries({ queryKey: ["ingest-tokens", workflowId] }),
  });
}
