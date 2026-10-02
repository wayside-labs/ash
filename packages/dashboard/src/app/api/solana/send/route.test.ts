import {
  address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPair,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  partiallySignTransaction,
  pipe,
  SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
  SolanaError,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { beforeEach, describe, expect, it, vi } from "vitest";

const rpc = vi.hoisted(() => ({
  send: vi.fn(),
  sent: [] as { cluster: string; wire: string }[],
}));

vi.mock("@/lib/server/solana", () => ({
  rpcFor: (cluster: string) => ({
    sendTransaction: (wire: string) => {
      rpc.sent.push({ cluster, wire });
      return { send: rpc.send };
    },
  }),
}));

const { POST } = await import("./route");

const HEADERS = {
  origin: "http://localhost:3000",
  host: "localhost:3000",
  "sec-fetch-site": "same-origin",
  "content-type": "application/json",
};

const post = (body: unknown) =>
  POST(
    new Request("http://localhost:3000/api/solana/send", {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
    }),
  );

/** A memo from a fresh fee payer: fully signed, or with the payer's signature missing. */
async function memo(signed: boolean): Promise<string> {
  const keys = await generateKeyPair();
  const payer = await getAddressFromPublicKey(keys.publicKey);
  const compiled = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(payer, m),
      (m) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash("4NCYB3kRT8sCNodPNuCZo8VUh4xqpBQxsxed2wd9xaD4"),
            lastValidBlockHeight: 100n,
          },
          m,
        ),
      (m) =>
        appendTransactionMessageInstructions(
          [
            {
              programAddress: address("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
              data: new TextEncoder().encode("hi"),
            },
          ],
          m,
        ),
    ),
  );
  return getBase64EncodedWireTransaction(
    signed ? await partiallySignTransaction([keys], compiled) : compiled,
  );
}

function preflightFailure(cause: unknown, logs: string[]) {
  return new SolanaError(SOLANA_ERROR__JSON_RPC__SERVER_ERROR_SEND_TRANSACTION_PREFLIGHT_FAILURE, {
    cause,
    logs,
  } as never);
}

describe("POST /api/solana/send", () => {
  beforeEach(() => {
    rpc.send.mockReset();
    rpc.sent = [];
  });

  it("rejects an invalid payload", async () => {
    expect((await post({ cluster: "devnet" })).status).toBe(422);
  });

  it("sends nothing with a signature missing", async () => {
    const res = await post({ cluster: "devnet", transaction: await memo(false) });
    expect(res.status).toBe(422);
    expect(rpc.sent).toHaveLength(0);
  });

  it("sends a fully signed transaction to the cluster it was asked for", async () => {
    rpc.send.mockResolvedValueOnce("sig");
    const wire = await memo(true);
    const res = await post({ cluster: "devnet", rpc: null, transaction: wire });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ signature: "sig" });
    expect(rpc.sent).toEqual([{ cluster: "devnet", wire }]);
  });

  it("says the transaction expired when its blockhash is gone", async () => {
    rpc.send.mockRejectedValueOnce(
      preflightFailure(new SolanaError(SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND), []),
    );
    const res = await post({ cluster: "devnet", transaction: await memo(true) });
    expect(res.status).toBe(409);
  });

  it("passes the program's own error line back when the simulation refuses it", async () => {
    rpc.send.mockRejectedValueOnce(
      preflightFailure(null, [
        "Program 4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS invoke [1]",
        "Program log: AnchorError occurred. Error Code: ExceedsPerTxMax. Error Number: 6001.",
        "Program 4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS failed: custom program error: 0x1771",
      ]),
    );
    const res = await post({ cluster: "devnet", transaction: await memo(true) });
    expect(res.status).toBe(422);
    const { error } = (await res.json()) as { error: string };
    expect(error).toContain("custom program error: 0x1771");
  });
});
