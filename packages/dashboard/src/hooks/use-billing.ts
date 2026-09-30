"use client";

import { useQuery } from "@tanstack/react-query";
import type { BillingSummary } from "@/lib/billing";

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
