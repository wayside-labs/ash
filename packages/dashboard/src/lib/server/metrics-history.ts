/**
 * RPC walk for Metrics §5 (docs/product/metrics-page.md §G).
 *
 * Read-only. History is best-effort and windowed: public RPCs retain transaction
 * logs for days, not months, and there is no indexer behind this route.
 */

import { address, createSolanaRpc, type Signature } from "@solana/kit";
import {
  HISTORY_PAGE_LIMIT,
  type JsonTransaction,
  recordsFromTransaction,
  type SessionContext,
} from "@/lib/metrics/history";
import { filterHistoryRecords, mergeHistoryRecords } from "@/lib/metrics/history-aggregate";
import type { PaymentHistory } from "@/lib/metrics/schema";
import type { SolanaCluster } from "@/lib/schema";
import { resolveRpcUrl } from "@/lib/server/solana";

export type FetchHistoryInput = {
  cluster: SolanaCluster;
  customRpc: string | null;
  sessions: SessionContext[];
  before?: string | null;
  limit?: number;
  outcome?: string | null;
  destination?: string | null;
};

function rpcFor(cluster: SolanaCluster, customRpc: string | null) {
  return createSolanaRpc(resolveRpcUrl(cluster, customRpc));
}

async function walkSession(
  rpc: ReturnType<typeof createSolanaRpc>,
  session: SessionContext,
  before: string | undefined,
  budget: number,
): Promise<{
  records: ReturnType<typeof recordsFromTransaction>;
  complete: boolean;
  oldestSlot: string | null;
  truncatedBy: PaymentHistory["truncatedBy"];
  nextBefore: string | null;
}> {
  const collected: ReturnType<typeof recordsFromTransaction> = [];
  let cursor = before;
  let complete = true;
  let oldestSlot: string | null = null;
  let truncatedBy: PaymentHistory["truncatedBy"] = null;
  let nextBefore: string | null = null;

  while (collected.length < budget) {
    const pageSize = Math.min(25, budget - collected.length);
    let signatures: { signature: string; slot: number }[];
    try {
      const response = await rpc
        .getSignaturesForAddress(address(session.session), {
          limit: pageSize,
          ...(cursor ? { before: cursor as Signature } : {}),
        })
        .send();
      signatures = response.map((entry) => ({
        signature: entry.signature,
        slot: Number(entry.slot),
      }));
    } catch {
      return {
        records: collected,
        complete: false,
        oldestSlot,
        truncatedBy: "rpc-error",
        nextBefore: cursor ?? null,
      };
    }

    if (signatures.length === 0) {
      complete = true;
      break;
    }

    if (signatures.length < pageSize) {
      complete = false;
      truncatedBy = "retention";
    }

    for (const entry of signatures) {
      oldestSlot = String(entry.slot);
      let tx: JsonTransaction | null = null;
      try {
        const response = await rpc
          .getTransaction(entry.signature as Signature, {
            encoding: "json",
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
          })
          .send();
        if (response) {
          tx = {
            slot: Number(response.slot),
            blockTime: response.blockTime === null ? null : Number(response.blockTime),
            meta: response.meta as JsonTransaction["meta"],
          };
        }
      } catch {
        continue;
      }
      if (!tx) continue;
      collected.push(...recordsFromTransaction(entry.signature, tx, session));
      if (collected.length >= budget) {
        complete = false;
        truncatedBy = "limit";
        nextBefore = entry.signature;
        break;
      }
    }

    if (collected.length >= budget) break;

    const last = signatures.at(-1);
    if (!last) break;
    cursor = last.signature;
    nextBefore = last.signature;

    if (signatures.length < pageSize) break;
  }

  return { records: collected, complete, oldestSlot, truncatedBy, nextBefore };
}

export async function fetchPaymentHistory(input: FetchHistoryInput): Promise<PaymentHistory> {
  const limit = Math.min(input.limit ?? 20, HISTORY_PAGE_LIMIT);
  if (input.sessions.length === 0) {
    return {
      records: [],
      complete: true,
      oldestSlot: null,
      truncatedBy: null,
      before: null,
    };
  }

  const rpc = rpcFor(input.cluster, input.customRpc);
  const walks = await Promise.all(
    input.sessions.map((session) => walkSession(rpc, session, input.before ?? undefined, limit)),
  );

  const merged = mergeHistoryRecords(walks.flatMap((walk) => walk.records));
  const filtered = filterHistoryRecords(merged, {
    outcome: input.outcome ?? null,
    destination: input.destination ?? null,
  }).slice(0, limit);

  const complete = walks.every((walk) => walk.complete);
  const truncatedBy = walks.find((walk) => walk.truncatedBy)?.truncatedBy ?? null;
  const oldestSlot =
    walks
      .map((walk) => walk.oldestSlot)
      .filter((slot): slot is string => Boolean(slot))
      .sort((left, right) => Number(left) - Number(right))[0] ?? null;
  const before = walks.find((walk) => walk.nextBefore)?.nextBefore ?? null;

  return {
    records: filtered,
    complete,
    oldestSlot,
    truncatedBy: complete ? null : truncatedBy,
    before,
  };
}
