import {
  type Address,
  getBase64Decoder,
  getBase64Encoder,
  type SignatureBytes,
  type SignatureDictionary,
  type Transaction,
  type TransactionPartialSigner,
} from "@solana/kit";

/**
 * A session signer that holds no key material (ADR-003; blueprint III-G).
 *
 * Prompt injection never leaks a session key, because the model never sees it — the key's
 * blast radius is already bounded by the policy. What this addresses is different and
 * narrower: a dependency compromise or a parser bug in the process that reads untrusted tool
 * arguments, which today can read raw key bytes off disk and spend offline until the session
 * expires or an operator revokes it.
 *
 * Moving signing behind an interface lets the key live somewhere that does not parse
 * attacker-controlled input: an enclave, an HSM, Turnkey, or a small service on another
 * host. Because this is Kit's `TransactionPartialSigner`, any such backend drops in without
 * changes here.
 *
 * The service should re-validate what it is asked to sign — program id, instruction
 * discriminator, and its own copy of the bound session — so that owning the mediation plane
 * is not the same as owning the treasury. That check belongs on the far side of this call;
 * this file only carries the bytes.
 */

export type RemoteSignerConfig = {
  /** Endpoint that signs a transaction message and returns a detached signature. */
  url: string;
  /** The public key the service signs with. Asserted against the session on binding. */
  address: Address;
  /** Sent as `Authorization`. */
  token?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 5_000;

export class RemoteSignerError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "RemoteSignerError";
  }
}

/**
 * Wire format, deliberately minimal:
 *
 *   POST { message_base64 }  ->  { signature_base64 }
 *
 * Only the message bytes cross the wire, so the service signs exactly what will be
 * broadcast and can decode it to decide whether it wants to.
 */
export function createRemoteSigner(config: RemoteSignerConfig): TransactionPartialSigner {
  const fetchImpl = config.fetchImpl ?? globalThis.fetch;
  const base64Decoder = getBase64Decoder();
  const base64Encoder = getBase64Encoder();

  if (typeof fetchImpl !== "function") {
    throw new RemoteSignerError("No fetch implementation is available for the remote signer");
  }

  async function signOne(transaction: Transaction): Promise<SignatureDictionary> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await fetchImpl(config.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(config.token ? { authorization: config.token } : {}),
        },
        body: JSON.stringify({
          message_base64: base64Decoder.decode(transaction.messageBytes),
          signer: config.address,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // No retry and no fallback to a local key: a signer that will not sign is a denial,
        // and quietly reaching for another key would defeat the point of moving it away.
        throw new RemoteSignerError(
          `Remote signer refused the transaction (HTTP ${response.status})`,
        );
      }

      const body = (await response.json()) as { signature_base64?: unknown };
      if (typeof body.signature_base64 !== "string") {
        throw new RemoteSignerError("Remote signer returned no signature_base64");
      }

      const signature = base64Encoder.encode(body.signature_base64) as SignatureBytes;
      if (signature.byteLength !== 64) {
        throw new RemoteSignerError(
          `Remote signer returned a ${signature.byteLength}-byte signature; expected 64`,
        );
      }

      return Object.freeze({ [config.address]: signature }) as SignatureDictionary;
    } catch (error) {
      if (error instanceof RemoteSignerError) throw error;
      throw new RemoteSignerError(
        `Remote signer unavailable: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    address: config.address,
    async signTransactions(transactions: readonly Transaction[]) {
      const signatures: SignatureDictionary[] = [];
      for (const transaction of transactions) {
        signatures.push(await signOne(transaction));
      }
      return signatures;
    },
  };
}
