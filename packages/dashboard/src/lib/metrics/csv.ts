/**
 * Payment history export (docs/product/metrics-page.md §5).
 *
 * Column order matches `paymentRecordSchema` field order — the same spelling the
 * MCP server and CLI sink write — so an operator tailing either file sees the
 * same headers in a dashboard export.
 */

import type { PaymentRecord } from "@agent-rails/contract/events";

/** RFC 4180: quote every field; double quotes inside. */
function csvCell(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * The contract schema's keys in definition order. Keeping this explicit rather
 * than introspecting Zod means a schema reorder is a deliberate export change.
 */
export const PAYMENT_RECORD_CSV_COLUMNS = [
  "ts",
  "treasury",
  "session",
  "policy",
  "intent",
  "outcome",
  "reason_code",
  "source",
  "destination",
  "destination_label",
  "mint",
  "amount",
  "reference",
  "signature",
  "receipt",
  "logs",
  "units_consumed",
  "detail",
] as const;

type Column = (typeof PAYMENT_RECORD_CSV_COLUMNS)[number];

function cellOf(record: PaymentRecord, column: Column): string {
  switch (column) {
    case "logs":
      return record.logs ? JSON.stringify(record.logs) : "";
    default: {
      const value = record[column as keyof PaymentRecord];
      return value === undefined || value === null ? "" : String(value);
    }
  }
}

export function paymentsToCsv(records: PaymentRecord[]): string {
  const header = PAYMENT_RECORD_CSV_COLUMNS.map(csvCell).join(",");
  const rows = records.map((record) =>
    PAYMENT_RECORD_CSV_COLUMNS.map((column) => csvCell(cellOf(record, column))).join(","),
  );
  return [header, ...rows].join("\n");
}

export function paymentsToJson(records: PaymentRecord[]): string {
  return `${JSON.stringify(records, null, 2)}\n`;
}
