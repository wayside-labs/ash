import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  getEnableNativeAllowanceInstruction,
} from "@agent-rails/client";
import {
  type Address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type TransactionSigner,
} from "@solana/kit";
import type { BlockhashLifetime } from "./payment-intent.js";
import {
  findAssociatedTokenAddress,
  findEventAuthorityPda,
  findNativeFixedDelegationPda,
  findNativeSubscriptionAuthorityPda,
  NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "./pdas.js";

export type EnableNativeAllowanceTxParams = {
  owner: TransactionSigner;
  treasury: Address;
  mint: Address;
  amountCap: bigint;
  expiryTs: bigint;
  /** Defaults to the owner's ATA for `mint`. Must already exist on-chain. */
  ownerAta?: Address;
  tokenProgram?: Address;
  recentBlockhash: BlockhashLifetime;
};

export type EnableNativeAllowanceTxResult = {
  wireTransaction: ReturnType<typeof getBase64EncodedWireTransaction>;
  ownerAta: Address;
  subscriptionAuthority: Address;
  nativeDelegation: Address;
};

/**
 * Builds a v0 transaction that calls `enable_native_allowance` (ADR-014). The owner
 * signs as fee payer and as the native program's delegator; the Treasury PDA becomes
 * the fixed delegation's `delegatee`, never the agent's session key.
 */
export async function enableNativeAllowanceTx(
  params: EnableNativeAllowanceTxParams,
): Promise<EnableNativeAllowanceTxResult> {
  const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
  const ownerAddress = params.owner.address;

  const [[ownerAta], [subscriptionAuthority], [eventAuthority]] = await Promise.all([
    params.ownerAta
      ? Promise.resolve([params.ownerAta] as const)
      : findAssociatedTokenAddress({
          owner: ownerAddress,
          mint: params.mint,
          tokenProgram,
        }),
    findNativeSubscriptionAuthorityPda({ owner: ownerAddress, mint: params.mint }),
    findEventAuthorityPda(),
  ]);

  const [nativeDelegation] = await findNativeFixedDelegationPda({
    subscriptionAuthority,
    delegator: ownerAddress,
    delegatee: params.treasury,
  });

  const instruction = getEnableNativeAllowanceInstruction({
    owner: params.owner,
    treasury: params.treasury,
    mint: params.mint,
    ownerAta,
    subscriptionAuthority,
    nativeDelegation,
    tokenProgram,
    nativeSubscriptionsProgram: NATIVE_SUBSCRIPTIONS_PROGRAM_ADDRESS,
    eventAuthority,
    program: AGENT_RAILS_PROGRAM_ADDRESS,
    amountCap: params.amountCap,
    expiryTs: params.expiryTs,
  });

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(params.owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(params.recentBlockhash, m),
    (m) => appendTransactionMessageInstruction(instruction, m),
  );

  return {
    wireTransaction: getBase64EncodedWireTransaction(compileTransaction(message)),
    ownerAta,
    subscriptionAuthority,
    nativeDelegation,
  };
}
