"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  BillingSummary,
  DepositIntentView,
  RailsConfig,
  WithdrawalDestinationKind,
  WithdrawalRequestView,
} from "@/lib/billing";

async function fetchBilling(): Promise<BillingSummary> {
  const res = await fetch("/api/billing", { headers: { "Content-Type": "application/json" } });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as BillingSummary;
}

export const BILLING_QUERY_KEY = ["billing"] as const;

export function useBilling(enabled = true) {
  return useQuery({ queryKey: BILLING_QUERY_KEY, queryFn: fetchBilling, enabled });
}

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

export function useRails(enabled = true) {
  return useQuery({
    queryKey: ["billing", "rails"],
    queryFn: () => send<RailsConfig>("/api/billing/rails", { method: "GET" }),
    enabled,
    staleTime: 5 * 60_000,
  });
}

export const WITHDRAWALS_QUERY_KEY = ["billing", "withdrawals"] as const;

export function useWithdrawals(enabled = true) {
  return useQuery({
    queryKey: WITHDRAWALS_QUERY_KEY,
    queryFn: () =>
      send<{ requests: WithdrawalRequestView[] }>("/api/billing/withdrawals", { method: "GET" }),
    enabled,
  });
}

export function createDeposit(amountUsd: string) {
  return send<{ intent: DepositIntentView }>("/api/billing/deposits", {
    method: "POST",
    body: JSON.stringify({ amountUsd }),
  });
}

export function checkDeposit(id: string) {
  return send<{ intent: DepositIntentView }>(`/api/billing/deposits/${id}/check`, {
    method: "POST",
  });
}

export function useRequestWithdrawal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      amountUsd: string;
      destinationKind: WithdrawalDestinationKind;
      destination: string;
    }) =>
      send<{ request: WithdrawalRequestView }>("/api/billing/withdrawals", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: BILLING_QUERY_KEY });
    },
  });
}

/** The unsigned fee-covered transfer, for the connected wallet to sign first. */
export function prepareDepositPayment(id: string, account: string) {
  return send<{ transaction: string }>(`/api/billing/deposits/${id}/pay`, {
    method: "POST",
    body: JSON.stringify({ account }),
  });
}

/** The wallet-signed transfer: the server adds the fee payer's signature and sends it. */
export function submitDepositPayment(id: string, transaction: string) {
  return send<{ signature: string }>(`/api/billing/deposits/${id}/submit`, {
    method: "POST",
    body: JSON.stringify({ transaction }),
  });
}
