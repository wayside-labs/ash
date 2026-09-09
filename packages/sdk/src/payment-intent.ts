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
  paymentBuildSchema,
  type PaymentBuildInput,
} from "@agent-rails/contract";
import {
  appendTransactionMessageInstruction,
  createTransactionMessage,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type TransactionMessage,
  type TransactionSigner,
} from "@solana/kit";
import { randomBytes } from "node:crypto";
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

export type PaymentIntentBuildResult = {
  path: PaymentPath;
  intent: PaymentIntent;
  instruction: Instruction;
  transactionMessage: TransactionMessage;
  pdas: PaymentPdas;
};

export function createIntentId(bytes?: Uint8Array): Uint8Array {
  if (bytes) {
    if (bytes.byteLength !== INTENT_ID_LEN) {
      throw new RangeError(`intentId must be ${INTENT_ID_LEN} bytes`);
    }
    return bytes;
  }
  return randomBytes(INTENT_ID_LEN);
}

function parseIntentFields(params: BuildPaymentIntentParams): PaymentIntent {
  const intentId = createIntentId(
    params.intent_id ? Uint8Array.from(Buffer.from(params.intent_id, "hex")) : undefined,
  );

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
    mint: params.mint,
    destination: params.destination,
    amount: params.amount,
    expiresAt: params.expires_at,
  };
  if (params.memo) {
    intent.memo = params.memo;
  }
  return intent;
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

function instructionPath(data: Uint8Array): PaymentPath {
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
  const intent = parseIntentFields(params);
  const [receipt] = await findReceiptPda({
    session: params.session,
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
  if (params.allowlistEntry) {
    pdas.allowlistEntry = params.allowlistEntry;
  }

  let instruction: Instruction;

  if (isNativeMint(intent.mint)) {
    instruction = await getExecutePaymentSolInstructionAsync({
      feePayer: params.feePayer,
      sessionKey: params.sessionKey,
      treasury: params.treasury,
      policy: params.policy,
      session: params.session,
      allowlistEntry: params.allowlistEntry,
      destinationOwner: intent.destination,
      receipt,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      intent: onChainIntent,
    });
    const solVaultAccount = instruction.accounts[6];
    if (solVaultAccount && typeof solVaultAccount.address === "string") {
      pdas.solVault = solVaultAccount.address;
    }
  } else {
    const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
    const [destinationAta] =
      params.destinationAta !== undefined
        ? [params.destinationAta]
        : await findAssociatedTokenAddress({
            owner: intent.destination,
            mint: intent.mint,
            tokenProgram,
          });

    instruction = await getExecutePaymentInstructionAsync({
      feePayer: params.feePayer,
      sessionKey: params.sessionKey,
      treasury: params.treasury,
      policy: params.policy,
      session: params.session,
      allowlistEntry: params.allowlistEntry,
      mint: intent.mint,
      destinationOwner: intent.destination,
      destinationAta,
      receipt,
      tokenProgram,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      intent: onChainIntent,
    });

    pdas.destinationAta = destinationAta;
    const vaultAtaAccount = instruction.accounts[7];
    if (vaultAtaAccount && typeof vaultAtaAccount.address === "string") {
      pdas.vaultAta = vaultAtaAccount.address;
    }
  }

  const path = instructionPath(instruction.data);
  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (message) => setTransactionMessageFeePayerSigner(params.feePayer, message),
    (message) => setTransactionMessageLifetimeUsingBlockhash(params.recentBlockhash, message),
    (message) => appendTransactionMessageInstruction(instruction, message),
  );

  return {
    path,
    intent,
    instruction,
    transactionMessage,
    pdas,
  };
}
