import {
  AccountRole,
  type Address,
  address,
  appendTransactionMessageInstructions,
  assertIsFullySignedTransaction,
  assertIsTransactionWithinSizeLimit,
  compileTransaction,
  createKeyPairFromBytes,
  createTransactionMessage,
  decompileTransactionMessage,
  getAddressEncoder,
  getAddressFromPublicKey,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getProgramDerivedAddress,
  getPublicKeyFromAddress,
  getTransactionDecoder,
  type Instruction,
  partiallySignTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Transaction,
  verifySignature,
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
 * Deposits where the platform pays the network fee. The customer's wallet signs first and the
 * server signs last. That is the order Phantom asks for when a transaction has more than one
 * signer: a wallet may add instructions of its own (Lighthouse assertions, a compute budget),
 * and a signature taken before that no longer matches. A transaction the server had already
 * signed left the wallet nothing to do but warn, and the wallet's own network setting decided
 * where it went. So nothing leaves here signed: the wallet signs the unsigned transfer, the
 * server reads what came back, adds the fee payer's signature, and sends it to the cluster the
 * deposit was opened on.
 *
 * The fee wallet is a hot key on the server holding a little SOL and nothing else. Its signature
 * authorizes every instruction that names it, so what it co-signs is fixed here: open the
 * recipient's USDC account if missing (idempotent, paid once), move exactly the intent's amount
 * from the signer to the recipient, plus what a wallet may add on its own — a compute budget
 * under a price cap, and Lighthouse assertions that never name the fee payer.
 */

type FeePayer = { address: Address; keyPair: CryptoKeyPair };

let cached: { raw: string; value: Promise<FeePayer> } | null = null;

/**
 * `SOLANA_PAY_FEE_PAYER_KEY`: the 64-byte secret as `solana-keygen`'s JSON array. Unset means
 * no sponsorship: the connected-wallet button is hidden and only the transfer request remains,
 * where the wallet pays the fee.
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

function openRecipientAccount(params: {
  payer: Address;
  destination: Address;
  recipient: Address;
  mint: Address;
}): Instruction {
  return {
    programAddress: address(ASSOCIATED_TOKEN_PROGRAM),
    accounts: [
      { address: params.payer, role: AccountRole.WRITABLE_SIGNER },
      { address: params.destination, role: AccountRole.WRITABLE },
      { address: params.recipient, role: AccountRole.READONLY },
      { address: params.mint, role: AccountRole.READONLY },
      { address: address(SYSTEM_PROGRAM), role: AccountRole.READONLY },
      { address: address(TOKEN_PROGRAM), role: AccountRole.READONLY },
    ],
    data: CREATE_ATA_IDEMPOTENT_DATA,
  };
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
  return [openRecipientAccount({ payer, destination, recipient, mint }), transfer];
}

/** What a deposit pays, from the stored intent — the same fields the deposit check reads. */
export type SponsoredIntent = {
  reference: string;
  recipient: string;
  mint: string;
  amountMicros: number;
};

/** The transaction the wallet signs first: the platform as fee payer, every signature empty. */
export async function buildSponsoredDeposit(
  config: SolanaPayConfig,
  intent: SponsoredIntent,
  customer: Address,
): Promise<string> {
  const payerPromise = feePayer();
  if (!payerPromise) throw new Error("no fee payer configured");
  const payer = await payerPromise;
  if (customer === intent.recipient || customer === payer.address) {
    throw new Error("the paying account cannot be the recipient or the fee payer");
  }
  const instructions = await depositInstructions({
    feePayer: payer.address,
    customer,
    recipient: address(intent.recipient),
    mint: address(intent.mint),
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
  return getBase64EncodedWireTransaction(compileTransaction(message));
}

// ---------------------------------------------------------------------------------------------
// What the fee payer co-signs

const COMPUTE_BUDGET_PROGRAM = "ComputeBudget111111111111111111111111111111";
/** Phantom's runtime assertions (docs.phantom.com/developer-powertools/lighthouse). */
const LIGHTHOUSE_PROGRAM = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";

/** The most priority fee one deposit may cost the fee wallet: 0.0001 SOL. */
export const MAX_PRIORITY_FEE_LAMPORTS = 100_000n;
const DEFAULT_UNITS_PER_INSTRUCTION = 200_000n;
const MAX_COMPUTE_UNITS = 1_400_000n;

/** The wallet returned something the fee payer must not sign. `reason` is for the log only. */
export class SponsoredDepositRefused extends Error {
  constructor(readonly reason: string) {
    super(`sponsored deposit refused: ${reason}`);
    this.name = "SponsoredDepositRefused";
  }
}

function refuse(reason: string): never {
  throw new SponsoredDepositRefused(reason);
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * By program, data and the ordered account addresses. Roles are left out on purpose: a
 * decompiled instruction takes each account's role from the whole message, so an instruction a
 * wallet added can make an account writable here without changing what this one does.
 */
function sameInstruction(a: Instruction, b: Instruction): boolean {
  const accountsA = a.accounts ?? [];
  const accountsB = b.accounts ?? [];
  return (
    a.programAddress === b.programAddress &&
    sameBytes(a.data ?? [], b.data ?? []) &&
    accountsA.length === accountsB.length &&
    accountsA.every((account, i) => account.address === accountsB[i]?.address)
  );
}

function computeBudgetArgument(data: ArrayLike<number>, bytes: 4 | 8): bigint {
  if (data.length !== 1 + bytes) refuse("compute budget data");
  const view = new DataView(Uint8Array.from(data).buffer);
  return bytes === 4 ? BigInt(view.getUint32(1, true)) : view.getBigUint64(1, true);
}

function decode(wire: Uint8Array) {
  try {
    const transaction = getTransactionDecoder().decode(wire);
    const compiled = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);
    return { transaction, compiled };
  } catch {
    return refuse("unreadable");
  }
}

/**
 * Reads a wallet-signed deposit and decides whether the fee payer may sign it. No RPC, so every
 * refusal is unit-tested. Throws `SponsoredDepositRefused`.
 */
export async function verifySponsoredDeposit(
  wire: Uint8Array,
  expected: {
    feePayer: Address;
    recipient: Address;
    mint: Address;
    reference: Address;
    amountMicros: number;
  },
): Promise<{ transaction: Transaction; customer: Address }> {
  const { transaction, compiled } = decode(wire);
  if (compiled.version !== 0) refuse("version");
  if (compiled.addressTableLookups?.length) refuse("address lookup tables");
  // Exactly the fee payer and the customer: every extra signer is another fee.
  if (compiled.header.numSignerAccounts !== 2) refuse("signer count");
  const [payer, customer] = compiled.staticAccounts;
  if (payer !== expected.feePayer) refuse("fee payer");
  if (!customer || customer === expected.recipient) refuse("customer");
  if (transaction.signatures[payer] != null) refuse("fee payer already signed");

  const customerSignature = transaction.signatures[customer];
  if (
    !customerSignature ||
    !(await verifySignature(
      await getPublicKeyFromAddress(customer),
      customerSignature,
      transaction.messageBytes,
    ))
  ) {
    refuse("customer signature");
  }

  const wanted = await depositInstructions({ ...expected, feePayer: payer, customer });
  let units: bigint | null = null;
  let microLamportsPerUnit = 0n;
  let counted = 0n;
  for (const instruction of decompileTransactionMessage(compiled).instructions) {
    if (instruction.programAddress === COMPUTE_BUDGET_PROGRAM) {
      if (instruction.accounts?.length) refuse("compute budget accounts");
      const data = instruction.data ?? [];
      switch (data[0]) {
        case 1: // RequestHeapFrame
        case 4: // SetLoadedAccountsDataSizeLimit
          computeBudgetArgument(data, 4);
          break;
        case 2: // SetComputeUnitLimit
          units = computeBudgetArgument(data, 4);
          break;
        case 3: // SetComputeUnitPrice, in micro-lamports per unit
          microLamportsPerUnit = computeBudgetArgument(data, 8);
          break;
        default:
          refuse("compute budget instruction");
      }
      continue;
    }
    counted += 1n;
    const at = wanted.findIndex((w) => sameInstruction(w, instruction));
    if (at !== -1) {
      wanted.splice(at, 1);
      continue;
    }
    // An assertion the wallet added: it may read anything except the account that pays.
    if (
      instruction.programAddress === LIGHTHOUSE_PROGRAM &&
      !(instruction.accounts ?? []).some((a) => a.address === payer)
    ) {
      continue;
    }
    refuse(`instruction for ${instruction.programAddress}`);
  }
  if (wanted.length) refuse("not the transfer requested");

  const limit = units ?? counted * DEFAULT_UNITS_PER_INSTRUCTION;
  const billed = limit > MAX_COMPUTE_UNITS ? MAX_COMPUTE_UNITS : limit;
  if ((billed * microLamportsPerUnit + 999_999n) / 1_000_000n > MAX_PRIORITY_FEE_LAMPORTS) {
    refuse("priority fee");
  }
  return { transaction, customer };
}

/** Checks the wallet's transaction, adds the fee payer's signature and sends it. */
export async function completeSponsoredDeposit(
  config: SolanaPayConfig,
  intent: SponsoredIntent,
  signedByWallet: string,
): Promise<string> {
  const payerPromise = feePayer();
  if (!payerPromise) throw new Error("no fee payer configured");
  const payer = await payerPromise;
  let wire: Uint8Array;
  try {
    wire = new Uint8Array(getBase64Encoder().encode(signedByWallet));
  } catch {
    refuse("not base64");
  }
  const { transaction } = await verifySponsoredDeposit(wire, {
    feePayer: payer.address,
    recipient: address(intent.recipient),
    mint: address(intent.mint),
    reference: address(intent.reference),
    amountMicros: intent.amountMicros,
  });
  const signed = await partiallySignTransaction([payer.keyPair], transaction);
  assertIsFullySignedTransaction(signed);
  assertIsTransactionWithinSizeLimit(signed);
  // Preflight stays on: a transfer that would fail is refused before it can cost a fee.
  return rpcFor(config.cluster, config.rpcUrl)
    .sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
}

// ---------------------------------------------------------------------------------------------
// The recipient's USDC account

const opened = new Set<string>();

/**
 * A transfer request pays into the recipient's USDC account and never opens it — Solana Pay's
 * own `createTransfer` refuses a recipient without one — so a fresh operator wallet would turn
 * every scanned payment away. The fee wallet opens it once, on the first deposit request.
 * Best effort: the caller logs a failure and the next request tries again.
 */
export async function ensureRecipientTokenAccount(config: SolanaPayConfig): Promise<void> {
  const key = `${config.cluster}:${config.recipient}:${config.mint}`;
  if (opened.has(key)) return;
  const recipient = address(config.recipient);
  const mint = address(config.mint);
  const destination = await associatedTokenAddress(recipient, mint);
  const rpc = rpcFor(config.cluster, config.rpcUrl);
  const { value } = await rpc
    .getAccountInfo(destination, { encoding: "base64", dataSlice: { offset: 0, length: 0 } })
    .send();
  if (value) {
    opened.add(key);
    return;
  }
  const payerPromise = feePayer();
  if (!payerPromise) {
    console.error(
      `[billing] ${config.recipient} has no USDC account on ${config.cluster} and no fee payer is set to open it; scanned deposits fail until it exists`,
    );
    return;
  }
  const payer = await payerPromise;
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "finalized" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(payer.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [openRecipientAccount({ payer: payer.address, destination, recipient, mint })],
        m,
      ),
  );
  const signed = await partiallySignTransaction([payer.keyPair], compileTransaction(message));
  const signature = await rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), {
      encoding: "base64",
      preflightCommitment: "confirmed",
    })
    .send();
  console.info(`[billing] opened the recipient's USDC account ${destination}: ${signature}`);
}
