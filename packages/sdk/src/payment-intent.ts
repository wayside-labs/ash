import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  EXECUTE_PAYMENT_DISCRIMINATOR,
  EXECUTE_PAYMENT_SOL_DISCRIMINATOR,
  getExecutePaymentInstructionAsync,
  getExecutePaymentSolInstructionAsync,
} from "@agent-rails/client";
import {
  INTENT_ID_LEN,
  NATIVE_MINT,
  type PaymentBuildInput,
  paymentBuildSchema,
} from "@agent-rails/contract";
import {
  type Address,
  address,
  appendTransactionMessageInstruction,
  type Blockhash,
  createTransactionMessage,
  type Instruction,
  pipe,
  type ReadonlyUint8Array,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type TransactionSigner,
} from "@solana/kit";
import {
  findAssociatedTokenAddress,
  findEventAuthorityPda,
  findReceiptPda,
  TOKEN_PROGRAM_ADDRESS,
} from "./pdas.js";

export type PaymentPath = "sol" | "spl";

export type PaymentIntent = {
  intentId: Uint8Array;
  mint: Address;
  destination: Address;
  amount: bigint;
  expiresAt: number;
  memo?: string;
};

export type PaymentIntentInput = {
  mint: Address;
  destination: Address;
  amount: bigint;
  expiresAt: number;
  memo?: string;
  intentId?: Uint8Array;
};

export type BlockhashLifetime = {
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
};

export type BuildPaymentIntentParams = PaymentBuildInput & {
  sessionKey: TransactionSigner;
  feePayer: TransactionSigner;
  recentBlockhash: BlockhashLifetime;
  destinationAta?: Address;
};

export type PaymentPdas = {
  receipt: Address;
  eventAuthority: Address;
  solVault?: Address;
  vaultAta?: Address;
  destinationAta?: Address;
  allowlistEntry?: Address;
};

function buildTransactionMessage(
  feePayer: TransactionSigner,
  recentBlockhash: BlockhashLifetime,
  instruction: Instruction,
) {
  return pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(feePayer, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(recentBlockhash, message),
    (message) => appendTransactionMessageInstruction(instruction, message),
  );
}

/**
 * A payment message that already carries its fee-payer signer and blockhash lifetime.
 *
 * Inferred from the builder rather than written out: `signTransactionMessageWithSigners`
 * and `partiallySignTransactionMessageWithSigners` both demand those proofs, and widening
 * to plain `TransactionMessage` at the boundary is what threw them away.
 */
export type PaymentTransactionMessage = ReturnType<typeof buildTransactionMessage>;

export type PaymentIntentBuildResult = {
  path: PaymentPath;
  intent: PaymentIntent;
  instruction: Instruction;
  transactionMessage: PaymentTransactionMessage;
  pdas: PaymentPdas;
};

/**
 * Validate an intent id. There is deliberately no generating branch.
 *
 * This used to fall back to 16 random bytes when a caller passed nothing, which quietly
 * disabled idempotency: a retry drew a new id, addressed a different receipt PDA, and paid
 * again. Ids come from `deriveIntentId` in `@agent-rails/contract`, which derives them from
 * the payment being settled so a retry collides by construction (blueprint III-A).
 */
export function createIntentId(bytes: Uint8Array): Uint8Array {
  if (bytes.byteLength !== INTENT_ID_LEN) {
    throw new RangeError(`intentId must be ${INTENT_ID_LEN} bytes`);
  }
  return bytes;
}

/**
 * The validated intent plus every context address branded as a Kit `Address`.
 *
 * `paymentBuildSchema` proves the base58 shape, but Zod infers plain `string`; the
 * instruction builders want the branded type. Branding once here is what keeps an
 * unchecked cast out of every call site below.
 */
type ParsedPayment = {
  intent: PaymentIntent;
  treasury: Address;
  policy: Address;
  session: Address;
  allowlistEntry?: Address;
  tokenProgram?: Address;
};

function parsePayment(params: BuildPaymentIntentParams): ParsedPayment {
  const intentId = createIntentId(Uint8Array.from(Buffer.from(params.intent_id, "hex")));

  paymentBuildSchema.parse({
    intent_id: Array.from(intentId, (byte) => byte.toString(16).padStart(2, "0")).join(""),
    mint: params.mint,
    destination: params.destination,
    amount: params.amount,
    expires_at: params.expires_at,
    memo: params.memo,
    treasury: params.treasury,
    policy: params.policy,
    session: params.session,
    allowlistEntry: params.allowlistEntry,
    tokenProgram: params.tokenProgram,
  });

  const intent: PaymentIntent = {
    intentId,
    mint: address(params.mint),
    destination: address(params.destination),
    amount: params.amount,
    expiresAt: params.expires_at,
  };
  if (params.memo) {
    intent.memo = params.memo;
  }

  const parsed: ParsedPayment = {
    intent,
    treasury: address(params.treasury),
    policy: address(params.policy),
    session: address(params.session),
  };
  // Assigned conditionally rather than as `?? undefined`: `exactOptionalPropertyTypes`
  // distinguishes an absent property from one explicitly set to `undefined`.
  if (params.allowlistEntry !== undefined) {
    parsed.allowlistEntry = address(params.allowlistEntry);
  }
  if (params.tokenProgram !== undefined) {
    parsed.tokenProgram = address(params.tokenProgram);
  }
  return parsed;
}

function encodeMemo(memo?: string): Uint8Array {
  if (!memo) {
    return new Uint8Array();
  }
  return new TextEncoder().encode(memo);
}

function isNativeMint(mint: Address): boolean {
  return mint === NATIVE_MINT;
}

function instructionPath(data: ReadonlyUint8Array | undefined): PaymentPath {
  if (data === undefined) {
    throw new Error("Payment instruction carries no data");
  }
  const discriminator = data.subarray(0, 8);
  if (discriminator.every((byte, index) => byte === EXECUTE_PAYMENT_SOL_DISCRIMINATOR[index])) {
    return "sol";
  }
  if (discriminator.every((byte, index) => byte === EXECUTE_PAYMENT_DISCRIMINATOR[index])) {
    return "spl";
  }
  throw new Error("Unknown payment instruction discriminator");
}

/**
 * Validates the payment payload, derives PDAs, and returns a Kit transaction message
 * with the correct `execute_payment` or `execute_payment_sol` instruction attached.
 */
export async function buildPaymentIntent(
  params: BuildPaymentIntentParams,
): Promise<PaymentIntentBuildResult> {
  const { intent, treasury, policy, session, allowlistEntry, tokenProgram } = parsePayment(params);
  const [receipt] = await findReceiptPda({
    session,
    intentId: intent.intentId,
  });
  const [eventAuthority] = await findEventAuthorityPda();

  const onChainIntent = {
    intentId: intent.intentId,
    mint: intent.mint,
    destinationOwner: intent.destination,
    amount: intent.amount,
    expiresAt: intent.expiresAt,
    memo: encodeMemo(intent.memo),
  };

  const pdas: PaymentPdas = {
    receipt,
    eventAuthority,
  };
  if (allowlistEntry !== undefined) {
    pdas.allowlistEntry = allowlistEntry;
  }

  let instruction: Instruction;

  if (isNativeMint(intent.mint)) {
    instruction = await getExecutePaymentSolInstructionAsync({
      feePayer: params.feePayer,
      sessionKey: params.sessionKey,
      treasury,
      policy,
      session,
      ...(allowlistEntry !== undefined ? { allowlistEntry } : {}),
      destinationOwner: intent.destination,
      receipt,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      intent: onChainIntent,
    });
    const solVaultAccount = instruction.accounts?.[6];
    if (solVaultAccount && typeof solVaultAccount.address === "string") {
      pdas.solVault = solVaultAccount.address;
    }
  } else {
    const splTokenProgram = tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
    const [destinationAta] =
      params.destinationAta !== undefined
        ? [params.destinationAta]
        : await findAssociatedTokenAddress({
            owner: intent.destination,
            mint: intent.mint,
            tokenProgram: splTokenProgram,
          });

    instruction = await getExecutePaymentInstructionAsync({
      feePayer: params.feePayer,
      sessionKey: params.sessionKey,
      treasury,
      policy,
      session,
      ...(allowlistEntry !== undefined ? { allowlistEntry } : {}),
      mint: intent.mint,
      destinationOwner: intent.destination,
      destinationAta,
      receipt,
      tokenProgram: splTokenProgram,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      intent: onChainIntent,
    });

    pdas.destinationAta = destinationAta;
    const vaultAtaAccount = instruction.accounts?.[7];
    if (vaultAtaAccount && typeof vaultAtaAccount.address === "string") {
      pdas.vaultAta = vaultAtaAccount.address;
    }
  }

  const path = instructionPath(instruction.data);
  const transactionMessage = buildTransactionMessage(
    params.feePayer,
    params.recentBlockhash,
    instruction,
  );

  return {
    path,
    intent,
    instruction,
    transactionMessage,
    pdas,
  };
}
