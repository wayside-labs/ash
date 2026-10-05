import { verifyAuditChain } from "@ash/sdk";
import { address } from "@solana/kit";
import type { PaymentRecordView } from "@/lib/metrics/schema";

function intentBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index++) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

/** Replay settled rows and compare against the on-chain audit head. Server-only. */
export function verifiedThroughBySession(
  records: PaymentRecordView[],
  sessions: { session: string; auditHead: string }[],
): Record<string, string | null> {
  const map: Record<string, string | null> = {};
  for (const row of sessions) {
    const settled = records
      .filter((record) => record.session === row.session && record.outcome === "settled")
      .sort((left, right) => left.ts.localeCompare(right.ts));
    const links = settled.map((record, index) => ({
      seq: BigInt(index + 1),
      intentId: intentBytes(record.intent),
      mint: address(record.mint ?? "11111111111111111111111111111111"),
      destinationOwner: address(record.destination ?? "11111111111111111111111111111111"),
      amount: BigInt(record.amount ?? "0"),
      slot: BigInt(index + 1),
    }));
    const head = Uint8Array.from(
      row.auditHead.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? [],
    );
    const result = verifyAuditChain({
      session: address(row.session),
      links,
      expectedHead: head,
    });
    map[row.session] = result.ok ? String(result.links) : null;
  }
  return map;
}
