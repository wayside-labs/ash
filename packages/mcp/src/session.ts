import { createKeyPairSignerFromBytes, type TransactionSigner } from "@solana/kit";
import type { McpRuntime } from "./config.js";
import { readKeypairBytes } from "./config.js";

export type SessionSigners = {
  sessionKey: TransactionSigner;
  feePayer: TransactionSigner;
};

export async function loadSessionSigners(runtime: McpRuntime): Promise<SessionSigners> {
  const sessionKeyBytes = await readKeypairBytes(runtime.config.signerKeypairPath);
  const sessionKey = await createKeyPairSignerFromBytes(sessionKeyBytes);

  if (runtime.config.feePayerKeypairPath) {
    const feePayerBytes = await readKeypairBytes(runtime.config.feePayerKeypairPath);
    const feePayer = await createKeyPairSignerFromBytes(feePayerBytes);
    return { sessionKey, feePayer };
  }

  return { sessionKey, feePayer: sessionKey };
}
