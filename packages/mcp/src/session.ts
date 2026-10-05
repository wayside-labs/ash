import { createRemoteSigner } from "@ash/sdk";
import { type Address, createKeyPairSignerFromBytes, type TransactionSigner } from "@solana/kit";
import type { McpRuntime } from "./config.js";
import { readKeypairBytes } from "./config.js";

export type SessionSigners = {
  sessionKey: TransactionSigner;
  feePayer: TransactionSigner;
};

/**
 * Load the signers this server pays with.
 *
 * Two modes. A keypair file is the simple one and puts private key bytes in the same
 * process that parses tool arguments — acceptable while the blast radius is a policy-bounded
 * session, and the thing to move first when it is not. A remote signer keeps the key
 * elsewhere and is configured by URL plus the public key it signs with (blueprint III-G).
 *
 * Either way `bindSession` then checks the signer against the on-chain `session_key`, so a
 * misconfigured signer fails at startup rather than as a stream of on-chain denials.
 */
export async function loadSessionSigners(runtime: McpRuntime): Promise<SessionSigners> {
  const sessionKey = await loadSessionKeySigner(runtime);

  if (runtime.config.feePayerKeypairPath) {
    const feePayerBytes = await readKeypairBytes(runtime.config.feePayerKeypairPath);
    const feePayer = await createKeyPairSignerFromBytes(feePayerBytes);
    return { sessionKey, feePayer };
  }

  return { sessionKey, feePayer: sessionKey };
}

async function loadSessionKeySigner(runtime: McpRuntime): Promise<TransactionSigner> {
  const { remoteSigner } = runtime.config;

  if (remoteSigner) {
    return createRemoteSigner({
      url: remoteSigner.url,
      address: remoteSigner.address as Address,
      ...(remoteSigner.token ? { token: remoteSigner.token } : {}),
    });
  }

  const sessionKeyBytes = await readKeypairBytes(runtime.config.signerKeypairPath);
  return createKeyPairSignerFromBytes(sessionKeyBytes);
}
