import { getAddressDecoder } from "@solana/kit";
import { describe, expect, it } from "vitest";
import {
  AUDIT_PREIMAGE_LEN,
  type AuditLink,
  auditHeadToHex,
  auditPreimage,
  DOMAIN_AUDIT,
  GENESIS_PREIMAGE_LEN,
  genesisAuditHead,
  genesisPreimage,
  nextAuditHead,
  verifyAuditChain,
} from "./audit.js";

/**
 * The same constants `crates/agent-rails-policy/tests/audit_vectors.rs` uses, so the two
 * implementations are pinned to one wire format rather than to each other's behaviour.
 * A byte array becomes an address here because that crate works in raw keys and this one
 * works in base58 — the encoding is the only difference between the two suites.
 */
const decodeAddress = getAddressDecoder();
const addressOf = (byte: number) => decodeAddress.decode(new Uint8Array(32).fill(byte));

const SESSION = addressOf(7);
const MINT = addressOf(3);
const DESTINATION = addressOf(9);
const INTENT_ID = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);

const link = (over: Partial<AuditLink> = {}): AuditLink => ({
  seq: 1n,
  intentId: INTENT_ID,
  mint: MINT,
  destinationOwner: DESTINATION,
  amount: 1_000_000n,
  slot: 42n,
  ...over,
});

describe("preimage layout", () => {
  it("matches the lengths the program hashes", () => {
    expect(DOMAIN_AUDIT.length).toBe(20);
    expect(GENESIS_PREIMAGE_LEN).toBe(52);
    expect(AUDIT_PREIMAGE_LEN).toBe(156);
  });

  it("places every field where the Rust vectors say it is", () => {
    const prev = genesisAuditHead(SESSION);
    const preimage = auditPreimage(prev, link());

    expect(preimage.subarray(0, 20)).toEqual(DOMAIN_AUDIT);
    expect(preimage.subarray(20, 52)).toEqual(prev);
    expect(preimage.subarray(52, 60)).toEqual(new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]));
    expect(preimage.subarray(60, 76)).toEqual(INTENT_ID);
    expect(preimage.subarray(76, 108)).toEqual(new Uint8Array(32).fill(3));
    expect(preimage.subarray(108, 140)).toEqual(new Uint8Array(32).fill(9));
    expect(preimage.subarray(148, 156)).toEqual(new Uint8Array([42, 0, 0, 0, 0, 0, 0, 0]));
  });

  it("puts the session in the genesis preimage", () => {
    const preimage = genesisPreimage(SESSION);
    expect(preimage.subarray(0, 20)).toEqual(DOMAIN_AUDIT);
    expect(preimage.subarray(20, 52)).toEqual(new Uint8Array(32).fill(7));
  });
});

/**
 * The two digests `pinned_digests` in the Rust suite asserts. They were produced by a third
 * implementation of spec §6, so a change to either value means the wire format moved and
 * every audit chain already issued has been invalidated.
 */
describe("pinned digests", () => {
  it("agrees with the policy crate on the genesis head", () => {
    expect(auditHeadToHex(genesisAuditHead(SESSION))).toBe(
      "d8790fb17ba65a49ca67334e1db9e59e8f968b169c60d484c6545ada311abebe",
    );
  });

  it("agrees with the policy crate on the first link", () => {
    const head = nextAuditHead(genesisAuditHead(SESSION), link());
    expect(auditHeadToHex(head)).toBe(
      "d2e5d4062e81892ac36fddc6072b3a5856756412ed3b74163564fc2d73bebfc0",
    );
  });
});

describe("verifyAuditChain", () => {
  const chainOf = (links: AuditLink[]) => {
    let head = genesisAuditHead(SESSION);
    for (const l of links) head = nextAuditHead(head, l);
    return head;
  };

  const two = [
    link({ seq: 1n, amount: 10n, slot: 1n }),
    link({ seq: 2n, intentId: new Uint8Array(16).fill(17), amount: 20n, slot: 2n }),
  ];

  it("accepts the chain the program would have written", () => {
    const result = verifyAuditChain({
      session: SESSION,
      links: two,
      expectedHead: chainOf(two),
    });
    expect(result).toMatchObject({ ok: true, links: 2 });
  });

  it("does not care what order the caller hands them over in", () => {
    const result = verifyAuditChain({
      session: SESSION,
      links: [...two].reverse(),
      expectedHead: chainOf(two),
    });
    expect(result.ok).toBe(true);
  });

  // The property the whole chain exists for: two payments swapped produce a different
  // terminal head, so a reordered export cannot pass as the real history.
  it("rejects a history whose payments were swapped", () => {
    const swapped = [
      link({ seq: 1n, intentId: new Uint8Array(16).fill(17), amount: 20n, slot: 2n }),
      link({ seq: 2n, amount: 10n, slot: 1n }),
    ];
    const result = verifyAuditChain({
      session: SESSION,
      links: swapped,
      expectedHead: chainOf(two),
    });
    expect(result).toMatchObject({ ok: false, reason: "head-mismatch", brokenAt: null });
  });

  it("names the gap when a payment is missing from the middle", () => {
    const result = verifyAuditChain({
      session: SESSION,
      links: [two[0] as AuditLink, link({ seq: 3n, amount: 30n, slot: 3n })],
      expectedHead: chainOf(two),
    });
    expect(result).toMatchObject({ ok: false, reason: "sequence-gap", brokenAt: 3n });
  });

  // A truncated tail is internally consistent, so it can only be caught by the head — which
  // is exactly why the head is read from the chain and not from the export.
  it("rejects a truncated history against the on-chain head", () => {
    const result = verifyAuditChain({
      session: SESSION,
      links: [two[0] as AuditLink],
      expectedHead: chainOf(two),
    });
    expect(result).toMatchObject({ ok: false, reason: "head-mismatch" });
  });

  it("rejects a forged amount", () => {
    const forged = [two[0] as AuditLink, link({ seq: 2n, amount: 999n, slot: 2n })];
    const result = verifyAuditChain({
      session: SESSION,
      links: forged,
      expectedHead: chainOf(two),
    });
    expect(result.ok).toBe(false);
  });

  it("accepts an empty chain only against the genesis head", () => {
    expect(
      verifyAuditChain({ session: SESSION, links: [], expectedHead: genesisAuditHead(SESSION) }).ok,
    ).toBe(true);
    expect(verifyAuditChain({ session: SESSION, links: [], expectedHead: chainOf(two) }).ok).toBe(
      false,
    );
  });

  // Two sessions never share a genesis, so a receipt cannot be replayed into another
  // session's history.
  it("binds the chain to its session", () => {
    expect(auditHeadToHex(genesisAuditHead(addressOf(7)))).not.toBe(
      auditHeadToHex(genesisAuditHead(addressOf(8))),
    );
  });
});
