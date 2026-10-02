import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  type KeyPairSigner,
  partiallySignTransaction,
} from "@solana/kit";

/**
 * The ephemeral key `create_treasury` requires as a signer. It seeds the treasury PDA,
 * signs once, and is never needed again — so it is generated non-extractable and simply
 * dropped with the page. Nothing is offered for download: losing it loses nothing.
 */
export async function generateCreateKey(): Promise<KeyPairSigner> {
  return generateKeyPairSigner();
}

/**
 * Adds the `create_key` signature to a wire transaction the wallet has already signed.
 *
 * After, not before: the wallet only signs (`solana:signTransaction`) and the dashboard sends,
 * so nothing is submitted until this key has signed too. Signing last is what Phantom asks for
 * with several signers: a wallet may add instructions of its own, and a signature taken before
 * that would no longer match the message.
 */
export async function signWithCreateKey(
  base64Transaction: string,
  createKey: KeyPairSigner,
): Promise<string> {
  const transaction = getTransactionDecoder().decode(getBase64Encoder().encode(base64Transaction));
  if (!(createKey.address in transaction.signatures)) {
    // A server that built something else must not get a signature from this key.
    throw new Error("CREATE_KEY_NOT_A_SIGNER");
  }
  const signed = await partiallySignTransaction([createKey.keyPair], transaction);
  return getBase64EncodedWireTransaction(signed);
}
