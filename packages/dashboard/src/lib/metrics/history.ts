/**
 * Payment history parsing (docs/product/metrics-page.md §G).
 *
 * Pure: no RPC here. The durable record is `PaymentExecuted` in transaction
 * inner instructions (`emit_cpi!`), not receipt accounts — those are
 * closeable an hour after the intent expires.
 */

import { createHash } from "node:crypto";
import {
  ASH_PROGRAM_ADDRESS,
  ashErrorFromCode,
  auditHeadToHex,
  customCodeFromTransactionError,
  PAYMENT_EXECUTED_EVENT_DISCRIMINATOR,
  parsePaymentExecutedEvent,
} from "@ash/sdk";
import { getBase58Decoder } from "@solana/kit";
import type { PaymentRecordView } from "./schema";

/** Anchor `emit_cpi!` event instruction tag, little-endian. */
export const EVENT_IX_TAG = new Uint8Array([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]);

export const HISTORY_PAGE_LIMIT = 100;

const base58 = getBase58Decoder();

export type SessionContext = {
  session: string;
  treasury: string;
  policy: string;
  decimalsByMint: Record<string, number>;
  symbolByMint: Record<string, string>;
  destinationLabels: Record<string, string>;
  workflow_id: string | null;
  agent_id: string | null;
  agent_name: string | null;
};

export type JsonInstruction = {
  programId: string;
  accounts: string[];
  data: string;
};

export type JsonInnerInstructions = {
  index: number;
  instructions: JsonInstruction[];
};

export type JsonTransactionMeta = {
  err: unknown;
  logMessages?: string[] | null;
  computeUnitsConsumed?: number | null;
  innerInstructions?: JsonInnerInstructions[] | null;
};

export type JsonTransaction = {
  slot: number;
  blockTime: number | null;
  meta: JsonTransactionMeta | null;
};

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function decodeInstructionData(data: string): Uint8Array | null {
  try {
    return Uint8Array.from(base58.decode(data as never));
  } catch {
    return null;
  }
}

export function parsePaymentExecutedInstruction(
  data: Uint8Array,
): ReturnType<typeof parsePaymentExecutedEvent> | null {
  if (data.length < 16) return null;
  if (!bytesEqual(data.subarray(0, 8), EVENT_IX_TAG)) return null;
  if (!bytesEqual(data.subarray(8, 16), Uint8Array.from(PAYMENT_EXECUTED_EVENT_DISCRIMINATOR)))
    return null;
  try {
    return parsePaymentExecutedEvent(data.subarray(8));
  } catch {
    return null;
  }
}

/** Pull every `PaymentExecuted` event out of a JSON-encoded transaction. */
export function extractPaymentExecutedEvents(
  meta: JsonTransactionMeta | null,
): ReturnType<typeof parsePaymentExecutedEvent>[] {
  if (!meta?.innerInstructions) return [];
  const events: ReturnType<typeof parsePaymentExecutedEvent>[] = [];

  for (const group of meta.innerInstructions) {
    for (const instruction of group.instructions) {
      if (instruction.programId !== ASH_PROGRAM_ADDRESS) continue;
      const data = decodeInstructionData(instruction.data);
      if (!data) continue;
      const event = parsePaymentExecutedInstruction(data);
      if (event) events.push(event);
    }
  }
  return events;
}

function intentFromSignature(signature: string): string {
  return createHash("sha256").update(signature).digest("hex").slice(0, 32);
}

function tsFromBlockTime(blockTime: number | null): string {
  return new Date((blockTime ?? 0) * 1000).toISOString();
}

export function paymentRecordFromExecutedEvent(
  event: ReturnType<typeof parsePaymentExecutedEvent>,
  signature: string,
  tx: JsonTransaction,
  ctx: SessionContext,
): PaymentRecordView {
  const mint = String(event.mint);
  return {
    ts: tsFromBlockTime(tx.blockTime),
    treasury: String(event.treasury),
    session: String(event.session),
    policy: ctx.policy,
    intent: auditHeadToHex(Uint8Array.from(event.intentId)),
    outcome: "settled",
    destination: String(event.destinationOwner),
    ...(ctx.destinationLabels[String(event.destinationOwner)]
      ? { destination_label: ctx.destinationLabels[String(event.destinationOwner)] }
      : {}),
    mint,
    amount: event.amount.toString(),
    signature,
    receipt: String(event.receipt),
    units_consumed: tx.meta?.computeUnitsConsumed?.toString(),
    decimals: ctx.decimalsByMint[mint] ?? null,
    symbol: ctx.symbolByMint[mint] ?? null,
    workflow_id: ctx.workflow_id,
    agent_id: ctx.agent_id,
    agent_name: ctx.agent_name,
    demo: false,
  };
}

/**
 * A failed `execute_payment` attempt: no event, but the program error is on chain.
 *
 * Destination and amount are not recoverable without decoding instruction data;
 * the row still carries the refusal so §6's histogram can count it.
 */
export function paymentRecordFromFailedTransaction(
  signature: string,
  tx: JsonTransaction,
  ctx: SessionContext,
): PaymentRecordView | null {
  const err = tx.meta?.err;
  if (!err) return null;
  const code = customCodeFromTransactionError(err);
  if (code === undefined) return null;
  const mapped = ashErrorFromCode(code, err);
  return {
    ts: tsFromBlockTime(tx.blockTime),
    treasury: ctx.treasury,
    session: ctx.session,
    policy: ctx.policy,
    intent: intentFromSignature(signature),
    outcome: "denied",
    reason_code: mapped.reasonCode,
    source: "program",
    signature,
    units_consumed: tx.meta?.computeUnitsConsumed?.toString(),
    detail: mapped.message,
    decimals: null,
    symbol: null,
    workflow_id: ctx.workflow_id,
    agent_id: ctx.agent_id,
    agent_name: ctx.agent_name,
    demo: false,
  };
}

export function recordsFromTransaction(
  signature: string,
  tx: JsonTransaction,
  ctx: SessionContext,
): PaymentRecordView[] {
  const events = extractPaymentExecutedEvents(tx.meta);
  if (events.length > 0) {
    return events
      .filter((event) => String(event.session) === ctx.session)
      .map((event) => paymentRecordFromExecutedEvent(event, signature, tx, ctx));
  }
  const denied = paymentRecordFromFailedTransaction(signature, tx, ctx);
  return denied ? [denied] : [];
}
