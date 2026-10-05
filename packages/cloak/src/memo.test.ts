import {
  address,
  appendTransactionMessageInstruction,
  type Blockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPair,
  getAddressFromPublicKey,
  getSignatureFromTransaction,
  getTransactionDecoder,
  getTransactionEncoder,
  pipe,
  type Rpc,
  type SolanaRpcApi,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { COMMITMENT_MEMO, MEMO_PROGRAM_ADDRESS } from "./commitment.js";
import { buildMemoTransaction, sendMemoTransaction } from "./memo.js";

const BLOCKHASH = "11111111111111111111111111111111";
const LIFETIME = { blockhash: BLOCKHASH, lastValidBlockHeight: 500n };
const utf8 = (text: string) => new TextEncoder().encode(text);

/** A wallet that signs with a real Ed25519 key, so the signatures here are real signatures. */
async function funder() {
  const keyPair = await generateKeyPair();
  const feePayer = await getAddressFromPublicKey(keyPair.publicKey);
  const signBytes = async (bytes: Uint8Array) => {
    const signed = await signTransaction([keyPair], getTransactionDecoder().decode(bytes));
    return new Uint8Array(getTransactionEncoder().encode(signed));
  };
  return { keyPair, feePayer, signBytes };
}

/** What a wallet that rewrites the transaction sends back: its own message, signed. */
async function rewrittenBy(
  keyPair: Awaited<ReturnType<typeof generateKeyPair>>,
  feePayer: string,
  memo: string | null,
) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(feePayer), m),
    (m) =>
      setTransactionMessageLifetimeUsingBlockhash(
        { blockhash: BLOCKHASH as Blockhash, lastValidBlockHeight: 500n },
        m,
      ),
    (m) =>
      appendTransactionMessageInstruction(
        {
          programAddress: address("ComputeBudget111111111111111111111111111111"),
          data: new Uint8Array([2, 64, 66, 15, 0]),
        },
        m,
      ),
    (m) =>
      memo === null
        ? m
        : appendTransactionMessageInstruction(
            { programAddress: address(MEMO_PROGRAM_ADDRESS), data: utf8(memo) },
            m,
          ),
  );
  const signed = await signTransaction([keyPair], compileTransaction(message));
  return new Uint8Array(getTransactionEncoder().encode(signed));
}

function stubRpc(statuses: unknown[] = [{ confirmationStatus: "confirmed", err: null }]) {
  const sent: string[] = [];
  let polls = 0;
  const rpc = {
    getLatestBlockhash: () => ({ send: async () => ({ value: LIFETIME }) }),
    sendTransaction: (wire: string) => ({
      send: async () => {
        sent.push(wire);
        return getSignatureFromTransaction(
          getTransactionDecoder().decode(new Uint8Array(Buffer.from(wire, "base64"))),
        );
      },
    }),
    getSignatureStatuses: () => ({
      send: async () => ({ value: [statuses[Math.min(polls++, statuses.length - 1)]] }),
    }),
  };
  return { rpc: rpc as unknown as Rpc<SolanaRpcApi>, sent, polls: () => polls };
}

describe("buildMemoTransaction", () => {
  it("is one instruction for the Memo program, carrying the text, signed for by the fee payer", async () => {
    const { feePayer } = await funder();
    const bytes = buildMemoTransaction(COMMITMENT_MEMO, feePayer, LIFETIME);
    const decoded = getTransactionDecoder().decode(bytes);

    // The memo's UTF-8 and the program's address are both in what gets signed.
    const message = Buffer.from(decoded.messageBytes);
    expect(message.includes(Buffer.from(COMMITMENT_MEMO, "utf8"))).toBe(true);
    // The fee payer is the first account and the only signature the transaction asks for.
    expect(Object.keys(decoded.signatures)).toEqual([feePayer]);
    expect(decoded.signatures[feePayer]).toBeNull();
  });

  it("is built the same way every time for the same inputs", async () => {
    const { feePayer } = await funder();
    const a = buildMemoTransaction(COMMITMENT_MEMO, feePayer, LIFETIME);
    const b = buildMemoTransaction(COMMITMENT_MEMO, feePayer, LIFETIME);
    expect(Array.from(a)).toEqual(Array.from(b));
    const other = buildMemoTransaction(`${COMMITMENT_MEMO}x`, feePayer, LIFETIME);
    expect(Array.from(other)).not.toEqual(Array.from(a));
  });

  it("refuses an empty memo and one too long for a transaction", async () => {
    const { feePayer } = await funder();
    expect(() => buildMemoTransaction("", feePayer, LIFETIME)).toThrow(/1 to 500 bytes/);
    expect(() => buildMemoTransaction("x".repeat(501), feePayer, LIFETIME)).toThrow(
      /1 to 500 bytes/,
    );
    expect(() => buildMemoTransaction("x".repeat(500), feePayer, LIFETIME)).not.toThrow();
  });

  it("counts bytes, not characters", async () => {
    const { feePayer } = await funder();
    expect(() => buildMemoTransaction("é".repeat(251), feePayer, LIFETIME)).toThrow(/bytes/);
  });

  it("refuses a fee payer that is not an address", () => {
    expect(() => buildMemoTransaction(COMMITMENT_MEMO, "not-an-address", LIFETIME)).toThrow();
  });
});

describe("sendMemoTransaction", () => {
  const instant = { pollMs: 0, sleep: async () => {} };

  it("has the wallet sign the transaction, sends exactly what came back, and returns its signature", async () => {
    const { feePayer, signBytes } = await funder();
    const sign = vi.fn(signBytes);
    const { rpc, sent } = stubRpc();

    const receipt = await sendMemoTransaction({
      rpc,
      memo: COMMITMENT_MEMO,
      feePayer,
      sign,
      ...instant,
    });

    expect(sign).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    const onWire = getTransactionDecoder().decode(
      new Uint8Array(Buffer.from(sent[0] ?? "", "base64")),
    );
    expect(receipt.signature).toBe(getSignatureFromTransaction(onWire));
    expect(receipt.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/);
    expect(Buffer.from(onWire.messageBytes).includes(Buffer.from(COMMITMENT_MEMO, "utf8"))).toBe(
      true,
    );
  });

  it("waits for the transaction to be confirmed, asking again until it is", async () => {
    const { feePayer, signBytes } = await funder();
    const { rpc, polls } = stubRpc([
      null,
      { confirmationStatus: "processed", err: null },
      { confirmationStatus: "confirmed", err: null },
    ]);
    const sleep = vi.fn(async () => {});
    await sendMemoTransaction({
      rpc,
      memo: COMMITMENT_MEMO,
      feePayer,
      sign: signBytes,
      pollMs: 250,
      sleep,
    });
    expect(polls()).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("accepts a finalized status as well", async () => {
    const { feePayer, signBytes } = await funder();
    const { rpc } = stubRpc([{ confirmationStatus: "finalized", err: null }]);
    await expect(
      sendMemoTransaction({ rpc, memo: COMMITMENT_MEMO, feePayer, sign: signBytes, ...instant }),
    ).resolves.toBeDefined();
  });

  it("says so when the transaction landed and failed", async () => {
    const { feePayer, signBytes } = await funder();
    const failure = { InstructionError: [0, "Custom"] };
    const { rpc } = stubRpc([{ confirmationStatus: "confirmed", err: failure }]);
    await expect(
      sendMemoTransaction({ rpc, memo: COMMITMENT_MEMO, feePayer, sign: signBytes, ...instant }),
    ).rejects.toMatchObject({ code: "unknown", cause: failure });
  });

  it("calls an unconfirmed transaction unknown, not failed: it may still land", async () => {
    const { feePayer, signBytes } = await funder();
    const { rpc, polls } = stubRpc([null]);
    await expect(
      sendMemoTransaction({
        rpc,
        memo: COMMITMENT_MEMO,
        feePayer,
        sign: signBytes,
        attempts: 4,
        ...instant,
      }),
    ).rejects.toMatchObject({ code: "outcome_unknown" });
    expect(polls()).toBe(4);
  });

  it("sends what a wallet that added its own instructions signed, as long as the memo is still in it", async () => {
    const { keyPair, feePayer } = await funder();
    const { rpc, sent } = stubRpc();
    await sendMemoTransaction({
      rpc,
      memo: COMMITMENT_MEMO,
      feePayer,
      sign: async () => rewrittenBy(keyPair, feePayer, COMMITMENT_MEMO),
      ...instant,
    });
    expect(sent).toHaveLength(1);
  });

  it("sends nothing when the signed transaction has lost the memo", async () => {
    const { keyPair, feePayer } = await funder();
    const { rpc, sent } = stubRpc();
    await expect(
      sendMemoTransaction({
        rpc,
        memo: COMMITMENT_MEMO,
        feePayer,
        sign: async () => rewrittenBy(keyPair, feePayer, null),
        ...instant,
      }),
    ).rejects.toThrow(/no longer carries the memo/);
    expect(sent).toEqual([]);
  });

  it("sends nothing when the memo in it is another text", async () => {
    const { keyPair, feePayer } = await funder();
    const { rpc, sent } = stubRpc();
    await expect(
      sendMemoTransaction({
        rpc,
        memo: COMMITMENT_MEMO,
        feePayer,
        sign: async () => rewrittenBy(keyPair, feePayer, "agent-rails/privacy-text/v1 sha256=00"),
        ...instant,
      }),
    ).rejects.toThrow(/no longer carries the memo/);
    expect(sent).toEqual([]);
  });

  it("sends nothing when the wallet hands back the transaction unsigned", async () => {
    const { feePayer } = await funder();
    const { rpc, sent } = stubRpc();
    await expect(
      sendMemoTransaction({
        rpc,
        memo: COMMITMENT_MEMO,
        feePayer,
        sign: async (bytes) => bytes,
        ...instant,
      }),
    ).rejects.toThrow();
    expect(sent).toEqual([]);
  });

  it("lets a closed wallet prompt through untouched, so the caller can name it", async () => {
    const { feePayer } = await funder();
    const { rpc, sent } = stubRpc();
    const rejection = { code: 4001, message: "User rejected the request." };
    await expect(
      sendMemoTransaction({
        rpc,
        memo: COMMITMENT_MEMO,
        feePayer,
        sign: async () => {
          throw rejection;
        },
        ...instant,
      }),
    ).rejects.toBe(rejection);
    expect(sent).toEqual([]);
  });
});
