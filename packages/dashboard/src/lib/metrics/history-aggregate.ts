import type { PaymentRecord } from "@ash/contract/events";
import type { PaymentRecordView } from "./schema";

export function mergeHistoryRecords(records: PaymentRecordView[]): PaymentRecordView[] {
  const byIntent = new Map<string, PaymentRecordView>();
  for (const record of records) {
    const existing = byIntent.get(record.intent);
    if (!existing) {
      byIntent.set(record.intent, record);
      continue;
    }
    if (existing.outcome !== "settled" && record.outcome === "settled") {
      byIntent.set(record.intent, record);
    } else if (record.ts > existing.ts) {
      byIntent.set(record.intent, record);
    }
  }
  return [...byIntent.values()].sort((left, right) => right.ts.localeCompare(left.ts));
}

export function filterHistoryRecords(
  records: PaymentRecordView[],
  filters: { outcome?: string | null; destination?: string | null },
): PaymentRecordView[] {
  return records.filter((record) => {
    if (filters.outcome && record.outcome !== filters.outcome) return false;
    if (filters.destination && record.destination !== filters.destination) return false;
    return true;
  });
}

export function toPaymentRecord(view: PaymentRecordView): PaymentRecord {
  const {
    decimals: _decimals,
    symbol: _symbol,
    workflow_id: _workflowId,
    agent_id: _agentId,
    agent_name: _agentName,
    demo: _demo,
    ...record
  } = view;
  return record;
}

export function denialsFromHistory(records: PaymentRecordView[]): {
  count: number;
  byReason: Record<string, number>;
} {
  const denied = records.filter(
    (record) => record.outcome === "denied" || record.outcome === "review_required",
  );
  const byReason: Record<string, number> = {};
  for (const row of denied) {
    const reason = row.reason_code ?? "UNKNOWN";
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return { count: denied.length, byReason };
}
