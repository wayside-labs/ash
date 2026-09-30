import {
  AccountRole,
  type Address,
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairFromBytes,
  createTransactionMessage,
  getAddressEncoder,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getProgramDerivedAddress,
  type Instruction,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from "@solana/kit";
import { rpcFor } from "@/lib/server/solana";
import {
  ASSOCIATED_TOKEN_PROGRAM,
  CREATE_ATA_IDEMPOTENT_DATA,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  transferCheckedData,
  USDC_DECIMALS,
} from "@/lib/solana-pay";
import type { SolanaPayConfig } from "./rails";

/**
 * Deposits where the platform pays the network fee (Solana Pay transaction requests). The
 * customer's wallet asks our server for the transaction, gets one whose fee payer is the
 * platform's fee wallet — already signed by it — and only has to approve the USDC moving.
 *
 * The fee wallet is a hot key on the server holding a little SOL and nothing else. What it can
 * be made to sign is fixed here: create the recipient's USDC account if missing (idempotent,
 * paid once), then move exactly the intent's amount from the customer to the recipient. Anyone
 * who fetches a transaction still has to pay us the USDC for the fee to be spent.
 */

type FeePayer = { address: Address; keyPair: CryptoKeyPair };

let cached: { raw: string; value: Promise<FeePayer> } | null = null;

/**
 * `SOLANA_PAY_FEE_PAYER_KEY`: the 64-byte secret as `solana-keygen`'s JSON array. Unset means
 * no sponsorship: deposits fall back to a plain transfer request, where the wallet pays the fee.
 */
export function feePayer(): Promise<FeePayer> | null {
  const raw = process.env.SOLANA_PAY_FEE_PAYER_KEY?.trim();
  if (!raw) return null;
  if (cached?.raw === raw) return cached.value;
  const value = (async () => {
    const bytes = Uint8Array.from(JSON.parse(raw) as number[]);
    if (bytes.length !== 64) throw new Error("SOLANA_PAY_FEE_PAYER_KEY must be a 64-byte array");
    const keyPair = await createKeyPairFromBytes(bytes);
    return { keyPair, address: await getAddressFromPublicKey(keyPair.publicKey) };
  })();
  cached = { raw, value };
  return value;
}

export async function associatedTokenAddress(owner: Address, mint: Address): Promise<Address> {
  const encoder = getAddressEncoder();
  const [ata] = await getProgramDerivedAddress({
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    seeds: [encoder.encode(owner), encoder.encode(address(TOKEN_PROGRAM)), encoder.encode(mint)],
  });
  return ata;
}

export async function depositInstructions(params: {
  feePayer: Address;
  customer: Address;
  recipient: Address;
  mint: Address;
  reference: Address;
  amountMicros: number;
}): Promise<Instruction[]> {
  const { feePayer: payer, customer, recipient, mint, reference } = params;
  const [source, destination] = await Promise.all([
    associatedTokenAddress(customer, mint),
    associatedTokenAddress(recipient, mint),
  ]);
  const createRecipientAccount: Instruction = {
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: destination, role: AccountRole.WRITABLE },
      { address: recipient, role: AccountRole.READONLY },
      { address: mint, role: AccountRole.READONLY },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
    ],
    data: CREATE_ATA_IDEMPOTENT_DATA,
  };
  const transfer: Instruction = {
    programAddress: address(TOKEN_PROGRAM),
    accounts: [
      { address: source, role: AccountRole.WRITABLE },
      { address: mint, role: AccountRole.READONLY },
      { address: destination, role: AccountRole.WRITABLE },
      { address: customer, role: AccountRole.READONLY_SIGNER },
      // Solana Pay's reference: a read-only non-signer key, how the deposit check finds this.
      { address: reference, role: AccountRole.READONLY },
    ],
    data: transferCheckedData(BigInt(params.amountMicros), USDC_DECIMALS),
  };
  return [createRecipientAccount, transfer];
}

/** The transaction the wallet signs: fee payer's signature in place, the customer's slot empty. */
export async function buildSponsoredDeposit(
  config: SolanaPayConfig,
  intent: { reference: string; amountMicros: number },
  customer: Address,
): Promise<string> {
  const payerPromise = feePayer();
  if (!payerPromise) throw new Error("no fee payer configured");
  const payer = await payerPromise;
  if (customer === config.recipient || customer === payer.address) {
    throw new Error("the paying account cannot be the recipient or the fee payer");
  }
  const instructions = await depositInstructions({
    feePayer: payer.address,
    customer,
    recipient: address(config.recipient),
    mint: address(config.mint),
    reference: address(intent.reference),
    amountMicros: intent.amountMicros,
  });
  const rpc = rpcFor(config.cluster, config.rpcUrl);
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "finalized" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(payer.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const signed = await partiallySignTransaction([payer.keyPair], compileTransaction(message));
  return getBase64EncodedWireTransaction(signed);
}
