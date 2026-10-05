import { createHash } from "node:crypto";
import {
  ASH_PROGRAM_ADDRESS,
  getIntentReceiptDecoder,
  INTENT_RECEIPT_DISCRIMINATOR,
} from "@ash/client";
import {
  type Address,
  type Base58EncodedBytes,
  type GetProgramAccountsApi,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Encoder,
  type Rpc,
} from "@solana/kit";

/**
 * The per-session audit hash chain (spec §6, ADR-006), in TypeScript.
 *
 * The program folds every executed payment into `AgentSession.audit_head`, so an auditor
 * who has the receipts can recompute the head and find out whether anything was omitted,
 * reordered or invented. Until now that check existed only in Rust, which meant the
 * property the product sells could not be run by the person being asked to trust it.
 *
 * This file is a second implementation, not a binding. It is pinned to the same vectors as
 * `crates/ash-policy/tests/audit_vectors.rs` — if the two ever disagree, one of
 * them is wrong and the test says so, which is the entire point of writing it twice.
 */

/** 12 bytes. Matches `DOMAIN_AUDIT` in the policy crate. */
export const DOMAIN_AUDIT = new TextEncoder().encode("ash/audit/v1");

export const GENESIS_PREIMAGE_LEN = 12 + 32;
export const AUDIT_PREIMAGE_LEN = 12 + 32 + 8 + 16 + 32 + 32 + 8 + 8;

const addressEncoder = getAddressEncoder();

function keyBytes(value: Address): Uint8Array {
  return Uint8Array.from(addressEncoder.encode(value));
}

function u64le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

function concat(parts: Uint8Array[], length: number): Uint8Array {
  const buf = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    buf.set(part, offset);
    offset += part.length;
  }
  if (offset !== length) {
    // A layout bug, not bad input: every field here is fixed width.
    throw new RangeError(`audit preimage is ${offset} bytes, expected ${length}`);
  }
  return buf;
}

function sha256(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(createHash("sha256").update(bytes).digest());
}

/** `DOMAIN_AUDIT ‖ session`. */
export function genesisPreimage(session: Address): Uint8Array {
  return concat([DOMAIN_AUDIT, keyBytes(session)], GENESIS_PREIMAGE_LEN);
}

/** The head a session starts from, before its first payment. */
export function genesisAuditHead(session: Address): Uint8Array {
  return sha256(genesisPreimage(session));
}

/** One executed payment, as the chain commits it. */
export type AuditLink = {
  /** The session's `seq` *after* this payment: the first payment commits 1. */
  seq: bigint;
  /** Raw 16 bytes, not hex. */
  intentId: Uint8Array;
  mint: Address;
  destinationOwner: Address;
  /** Base units debited from the vault, before any Token-2022 transfer fee. */
  amount: bigint;
  slot: bigint;
};

/** `DOMAIN_AUDIT ‖ prev ‖ seq ‖ intent_id ‖ mint ‖ destination ‖ amount ‖ slot`. */
export function auditPreimage(prev: Uint8Array, link: AuditLink): Uint8Array {
  if (prev.length !== 32) throw new RangeError("previous head must be 32 bytes");
  if (link.intentId.length !== 16) throw new RangeError("intent_id must be 16 bytes");
  return concat(
    [
      DOMAIN_AUDIT,
      prev,
      u64le(link.seq),
      Uint8Array.from(link.intentId),
      keyBytes(link.mint),
      keyBytes(link.destinationOwner),
      u64le(link.amount),
      u64le(link.slot),
    ],
    AUDIT_PREIMAGE_LEN,
  );
}

export function nextAuditHead(prev: Uint8Array, link: AuditLink): Uint8Array {
  return sha256(auditPreimage(prev, link));
}

export function auditHeadToHex(head: Uint8Array): string {
  return Array.from(head, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export type AuditChainVerification =
  | { ok: true; head: string; links: number }
  /**
   * `brokenAt` is the `seq` of the first link that does not fit, or `null` when the links
   * are internally consistent and disagree with the on-chain head — which is the shape of
   * a *missing tail*, not of a tampered row.
   */
  | {
      ok: false;
      head: string;
      expectedHead: string;
      links: number;
      brokenAt: bigint | null;
      reason: "sequence-gap" | "head-mismatch";
    };

/**
 * Replay `links` from the session's genesis and compare the result with `expectedHead`,
 * which is `AgentSession.audit_head` as the chain reports it.
 *
 * Links must be every payment of the session, in order. A gap is reported rather than
 * hashed over: without it, a missing receipt and a forged one look the same at the end.
 */
export function verifyAuditChain(input: {
  session: Address;
  links: AuditLink[];
  expectedHead: Uint8Array;
}): AuditChainVerification {
  const expected = auditHeadToHex(input.expectedHead);
  const sorted = [...input.links].sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));

  let head = genesisAuditHead(input.session);
  for (const [index, link] of sorted.entries()) {
    const want = BigInt(index + 1);
    if (link.seq !== want) {
      return {
        ok: false,
        head: auditHeadToHex(head),
        expectedHead: expected,
        links: sorted.length,
        brokenAt: link.seq,
        reason: "sequence-gap",
      };
    }
    head = nextAuditHead(head, link);
  }

  const computed = auditHeadToHex(head);
  if (computed !== expected) {
    return {
      ok: false,
      head: computed,
      expectedHead: expected,
      links: sorted.length,
      brokenAt: null,
      reason: "head-mismatch",
    };
  }
  return { ok: true, head: computed, links: sorted.length };
}

/** One receipt as read from the chain: the link, plus the fields only the account carries. */
export type ReceiptRecord = AuditLink & {
  receipt: Address;
  session: Address;
  intentIdHex: string;
  timestamp: bigint;
  expiresAt: bigint;
  status: number;
  feePayer: Address;
  memoHash: string;
};

const SESSION_FIELD_OFFSET = 10n;

/**
 * Every `IntentReceipt` of one session, ordered by `seq`.
 *
 * Read straight from the program's accounts rather than from an indexer: a receipt is the
 * artifact the program itself wrote, and the whole point of the export is that it does not
 * depend on our own infrastructure being honest. The cost is that a closed receipt is gone
 * — `close_receipt` reclaims rent after the grace period — so a long-lived session's chain
 * can only be replayed as far back as its oldest surviving receipt.
 */
export async function loadReceipts(input: {
  rpc: Rpc<GetProgramAccountsApi>;
  session: Address;
}): Promise<ReceiptRecord[]> {
  const discriminator = getBase58Decoder().decode(INTENT_RECEIPT_DISCRIMINATOR);
  const accounts = await input.rpc
    .getProgramAccounts(ASH_PROGRAM_ADDRESS, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0n, bytes: discriminator as Base58EncodedBytes, encoding: "base58" } },
        {
          memcmp: {
            offset: SESSION_FIELD_OFFSET,
            bytes: input.session as string as Base58EncodedBytes,
            encoding: "base58",
          },
        },
      ],
    })
    .send();

  const decoder = getIntentReceiptDecoder();
  const base64 = getBase64Encoder();

  return accounts
    .map((account) => {
      const raw = Array.isArray(account.account.data)
        ? account.account.data[0]
        : account.account.data;
      const decoded = decoder.decode(base64.encode(raw as string));
      const intentId = Uint8Array.from(decoded.intentId);
      return {
        receipt: account.pubkey,
        session: decoded.session,
        seq: decoded.seq,
        intentId,
        intentIdHex: auditHeadToHex(intentId),
        mint: decoded.mint,
        destinationOwner: decoded.destinationOwner,
        amount: decoded.amount,
        slot: decoded.slot,
        timestamp: decoded.timestamp,
        expiresAt: decoded.expiresAt,
        status: decoded.status,
        feePayer: decoded.feePayer,
        memoHash: auditHeadToHex(Uint8Array.from(decoded.memoHash)),
      } satisfies ReceiptRecord;
    })
    .sort((a, b) => (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0));
}
