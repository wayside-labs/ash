import { type Address, getBase64Decoder, type TransactionPartialSigner } from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import { createRemoteSigner, RemoteSignerError } from "./remote-signer.js";

const SIGNER = "So11111111111111111111111111111111111111112" as Address;
const MESSAGE_BYTES = new Uint8Array([1, 2, 3, 4]);
const SIGNATURE = getBase64Decoder().decode(new Uint8Array(64).fill(9));

/** What `signTransactions` actually accepts: a Transaction already proven to fit a packet
 * and to carry a lifetime. Naming it via the signature keeps this fixture correct if Kit
 * tightens the constraint again. */
type SignableTransaction = Parameters<TransactionPartialSigner["signTransactions"]>[0][number];

function transaction(): SignableTransaction {
  return { messageBytes: MESSAGE_BYTES, signatures: {} } as unknown as SignableTransaction;
}

function responding(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  })) as unknown as typeof fetch;
}

describe("createRemoteSigner", () => {
  it("falls back to the global fetch when none is configured", () => {
    expect(() => createRemoteSigner({ url: "https://signer.test", address: SIGNER })).not.toThrow();
  });

  // Fails at construction rather than at the first signature: a signer that cannot reach
  // its backend is worth discovering while wiring up, not mid-payment.
  it("refuses to be built when no fetch exists at all", () => {
    vi.stubGlobal("fetch", undefined);
    try {
      expect(() => createRemoteSigner({ url: "https://signer.test", address: SIGNER })).toThrow(
        RemoteSignerError,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("sends only the message bytes, base64, with the signer address", async () => {
    const fetchImpl = responding({ signature_base64: SIGNATURE });
    const signer = createRemoteSigner({
      url: "https://signer.test",
      address: SIGNER,
      token: "Bearer t0ken",
      fetchImpl,
    });

    const [dictionary] = await signer.signTransactions([transaction()]);
    expect(dictionary?.[SIGNER]).toHaveLength(64);

    const [url, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://signer.test");
    const body = JSON.parse(init.body as string);
    // The service signs exactly what will be broadcast, so it must receive the message and
    // nothing else — no key material, no assembled transaction.
    expect(body).toEqual({
      message_base64: getBase64Decoder().decode(MESSAGE_BYTES),
      signer: SIGNER,
    });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer t0ken");
  });

  it("omits the authorization header when no token is configured", async () => {
    const fetchImpl = responding({ signature_base64: SIGNATURE });
    await createRemoteSigner({
      url: "https://signer.test",
      address: SIGNER,
      fetchImpl,
    }).signTransactions([transaction()]);
    const [, init] = vi.mocked(fetchImpl).mock.calls[0] as [string, RequestInit];
    expect(init.headers).not.toHaveProperty("authorization");
  });

  it("signs each transaction in a batch", async () => {
    const fetchImpl = responding({ signature_base64: SIGNATURE });
    const signatures = await createRemoteSigner({
      url: "https://signer.test",
      address: SIGNER,
      fetchImpl,
    }).signTransactions([transaction(), transaction()]);
    expect(signatures).toHaveLength(2);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // A signer that will not sign is a denial. Falling back to a local key would give back
  // exactly the blast radius that moving the key away was meant to remove.
  it("treats a refusal as an error rather than retrying or falling back", async () => {
    const fetchImpl = responding({}, { ok: false, status: 403 });
    await expect(
      createRemoteSigner({
        url: "https://signer.test",
        address: SIGNER,
        fetchImpl,
      }).signTransactions([transaction()]),
    ).rejects.toThrow(/HTTP 403/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects a response with no signature", async () => {
    const fetchImpl = responding({ signature_base64: 42 });
    await expect(
      createRemoteSigner({
        url: "https://signer.test",
        address: SIGNER,
        fetchImpl,
      }).signTransactions([transaction()]),
    ).rejects.toThrow(/no signature_base64/);
  });

  // A short signature would otherwise reach the cluster and fail there, where the cause is
  // far less obvious than it is here.
  it("rejects a signature that is not 64 bytes", async () => {
    const fetchImpl = responding({
      signature_base64: getBase64Decoder().decode(new Uint8Array(32)),
    });
    await expect(
      createRemoteSigner({
        url: "https://signer.test",
        address: SIGNER,
        fetchImpl,
      }).signTransactions([transaction()]),
    ).rejects.toThrow(/32-byte signature; expected 64/);
  });

  it("wraps a transport failure as unavailable, keeping the cause", async () => {
    const cause = new Error("ECONNREFUSED");
    const fetchImpl = vi.fn(async () => {
      throw cause;
    }) as unknown as typeof fetch;

    const error = (await createRemoteSigner({
      url: "https://signer.test",
      address: SIGNER,
      fetchImpl,
    })
      .signTransactions([transaction()])
      .catch((e: unknown) => e)) as RemoteSignerError;

    expect(error).toBeInstanceOf(RemoteSignerError);
    expect(error.message).toContain("ECONNREFUSED");
    expect(error.cause).toBe(cause);
  });

  it("aborts a request that outlives its timeout", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new Error("The operation was aborted")),
          );
        }),
    ) as unknown as typeof fetch;

    await expect(
      createRemoteSigner({
        url: "https://signer.test",
        address: SIGNER,
        timeoutMs: 5,
        fetchImpl,
      }).signTransactions([transaction()]),
    ).rejects.toThrow(/aborted/);
  });

  it("exposes the configured address as the signer identity", () => {
    const fetchImpl = responding({ signature_base64: SIGNATURE });
    expect(
      createRemoteSigner({ url: "https://signer.test", address: SIGNER, fetchImpl }).address,
    ).toBe(SIGNER);
  });
});
