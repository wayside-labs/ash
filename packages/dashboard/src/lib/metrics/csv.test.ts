import { USDC_MINT_DEVNET } from "@agent-rails/contract/mints";
import { describe, expect, it } from "vitest";
import { PAYMENT_RECORD_CSV_COLUMNS, paymentsToCsv, paymentsToJson } from "./csv";
import { toPaymentRecord } from "./history-aggregate";
import type { PaymentRecordView } from "./schema";

const ROW: PaymentRecordView = {
  ts: "2026-09-25T12:00:00.000Z",
  treasury: "2xbbqA1KvP7znHHk59tCbyN85cyHTy5hcwpQnwTKGc1i",
  session: "7v5FqEj8DaCbvJPEqpUtZXKyLBtrHuxhG2tWayTaJd4C",
  policy: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1",
  intent: "9c4e17bb5af2408da6013e7cd1a50001",
  outcome: "settled",
  destination: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
  destination_label: "Acme Hosting",
  mint: USDC_MINT_DEVNET,
  amount: "120000000",
  signature:
    "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW",
  decimals: 6,
  symbol: "USDC",
  workflow_id: null,
  agent_id: null,
  agent_name: null,
  demo: false,
};

describe("paymentsToCsv", () => {
  it("uses paymentRecordSchema column order in the header", () => {
    const csv = paymentsToCsv([toPaymentRecord(ROW)]);
    const [header] = csv.split("\n");
    expect(header).toBe(PAYMENT_RECORD_CSV_COLUMNS.map((column) => `"${column}"`).join(","));
  });

  it("quotes fields and omits view-only columns", () => {
    const csv = paymentsToCsv([toPaymentRecord(ROW)]);
    expect(csv).toContain('"Acme Hosting"');
    expect(csv).not.toContain("workflow_id");
    expect(csv).not.toContain("demo");
  });
});

describe("paymentsToJson", () => {
  it("exports contract records without view fields", () => {
    const json = JSON.parse(paymentsToJson([toPaymentRecord(ROW)])) as PaymentRecordView[];
    expect(json[0]?.intent).toBe(ROW.intent);
    expect(json[0]).not.toHaveProperty("decimals");
  });
});
