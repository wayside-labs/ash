import { USDC_MINT_DEVNET } from "@ash/contract/mints";
import { getPaymentExecutedEventEncoder } from "@ash/sdk";
import { address } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  EVENT_IX_TAG,
  type JsonTransaction,
  parsePaymentExecutedInstruction,
  paymentRecordFromExecutedEvent,
  recordsFromTransaction,
  type SessionContext,
} from "./history";
import { denialsFromHistory, mergeHistoryRecords } from "./history-aggregate";

const SESSION = "7v5FqEj8DaCbvJPEqpUtZXKyLBtrHuxhG2tWayTaJd4C";
const TREASURY = "2xbbqA1KvP7znHHk59tCbyN85cyHTy5hcwpQnwTKGc1i";
const POLICY = "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1";
const DESTINATION = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const RECEIPT = "6XU36wCxWobLx5Rtsb58kmgAKKJYoGkGfqALcW1JTBWY";

function ctx(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    session: SESSION,
    treasury: TREASURY,
    policy: POLICY,
    decimalsByMint: { [USDC_MINT_DEVNET]: 6 },
    symbolByMint: { [USDC_MINT_DEVNET]: "USDC" },
    destinationLabels: { [DESTINATION]: "Acme Hosting" },
    workflow_id: "w_demo",
    agent_id: "a_demo",
    agent_name: "CFO Bot",
    ...overrides,
  };
}

function sampleEvent() {
  const intentId = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  return {
    treasury: address(TREASURY),
    schemaVersion: 1,
    session: address(SESSION),
    seq: 1n,
    auditHead: Uint8Array.from({ length: 32 }, () => 0xab),
    intentId,
    mint: address(USDC_MINT_DEVNET),
    destinationOwner: address(DESTINATION),
    amount: 120_000_000n,
    slot: 302_118_004n,
    memoHash: Uint8Array.from({ length: 32 }, () => 0xcd),
    receipt: address(RECEIPT),
  };
}

function instructionBytes(): Uint8Array {
  const payload = getPaymentExecutedEventEncoder().encode(sampleEvent());
  const data = new Uint8Array(EVENT_IX_TAG.length + payload.length);
  data.set(EVENT_IX_TAG, 0);
  data.set(payload, EVENT_IX_TAG.length);
  return data;
}

describe("parsePaymentExecutedInstruction", () => {
  it("decodes a PaymentExecuted inner instruction", () => {
    const event = parsePaymentExecutedInstruction(instructionBytes());
    expect(event?.amount).toBe(120_000_000n);
    expect(String(event?.session)).toBe(SESSION);
  });

  it("returns null for foreign bytes", () => {
    expect(parsePaymentExecutedInstruction(new Uint8Array(32))).toBeNull();
  });
});

describe("recordsFromTransaction", () => {
  it("maps a settled payment to a PaymentRecordView", () => {
    const signature =
      "5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";
    const tx: JsonTransaction = {
      slot: 302_118_004,
      blockTime: 1_700_000_000,
      meta: {
        err: null,
        computeUnitsConsumed: 42_000,
        innerInstructions: [
          {
            index: 0,
            instructions: [
              {
                programId: "4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS",
                accounts: [],
                data: "ignored",
              },
            ],
          },
        ],
      },
    };
    const event = sampleEvent();
    const records = [paymentRecordFromExecutedEvent(event, signature, tx, ctx())];
    expect(records[0]?.outcome).toBe("settled");
    expect(records[0]?.destination_label).toBe("Acme Hosting");
    expect(records[0]?.signature).toBe(signature);
    expect(records[0]?.demo).toBe(false);
  });

  it("maps a failed payment to a denied row with a reason code", () => {
    const signature =
      "4VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUV";
    const tx: JsonTransaction = {
      slot: 302_118_003,
      blockTime: 1_700_000_000,
      meta: {
        err: { InstructionError: [0, { Custom: 6015 }] },
        computeUnitsConsumed: 12_000,
        innerInstructions: [],
      },
    };
    const records = recordsFromTransaction(signature, tx, ctx());
    expect(records).toHaveLength(1);
    expect(records[0]?.outcome).toBe("denied");
    expect(records[0]?.reason_code).toBe("DESTINATION_NOT_ALLOWED");
    expect(records[0]?.source).toBe("program");
  });
});

describe("mergeHistoryRecords", () => {
  it("sorts newest first and dedupes by intent", () => {
    const older = paymentRecordFromExecutedEvent(
      sampleEvent(),
      "sig-a",
      { slot: 1, blockTime: 1, meta: null },
      ctx(),
    );
    const newer = { ...older, ts: new Date(2_000).toISOString() };
    const merged = mergeHistoryRecords([older, newer]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.ts).toBe(newer.ts);
  });
});

describe("denialsFromHistory", () => {
  it("counts program denials by reason", () => {
    const summary = denialsFromHistory([
      {
        ts: new Date().toISOString(),
        treasury: TREASURY,
        session: SESSION,
        policy: POLICY,
        intent: "b".repeat(32),
        outcome: "denied",
        reason_code: "EXCEEDS_SHORT_WINDOW",
        source: "program",
        decimals: null,
        symbol: null,
        workflow_id: null,
        agent_id: null,
        agent_name: null,
        demo: false,
      },
    ]);
    expect(summary.count).toBe(1);
    expect(summary.byReason.EXCEEDS_SHORT_WINDOW).toBe(1);
  });
});
