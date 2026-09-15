import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  findEntryPda,
  findPolicyPda,
  findSessionPda,
  findSolVaultPda,
  findTreasuryPda,
} from "@agent-rails/client";
import { SEED_RECEIPT } from "@agent-rails/contract";
import type { Address } from "@solana/kit";
import { getAddressEncoder, getBytesEncoder, getProgramDerivedAddress } from "@solana/kit";

const addressEncoder = getAddressEncoder();
const bytesEncoder = getBytesEncoder();

export const TOKEN_PROGRAM_ADDRESS =
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" as Address<"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA">;

export const ASSOCIATED_TOKEN_PROGRAM_ADDRESS =
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL" as Address<"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL">;

export {
  findEntryPda,
  findEntryPda as findAllowlistPda,
  findPolicyPda,
  findSessionPda,
  findSolVaultPda,
  findTreasuryPda,
};

export type ReceiptPdaInput = {
  session: Address;
  intentId: Uint8Array;
};

/** Receipt PDA helper until Codama emits it from the IDL seed graph. */
export async function findReceiptPda(input: ReceiptPdaInput) {
  if (input.intentId.byteLength !== 16) {
    throw new RangeError("intentId must be exactly 16 bytes");
  }
  return getProgramDerivedAddress({
    programAddress: AGENT_RAILS_PROGRAM_ADDRESS,
    seeds: [SEED_RECEIPT, addressEncoder.encode(input.session), input.intentId],
  });
}

/** Anchor `emit_cpi!` event authority PDA. */
export async function findEventAuthorityPda(config: { programAddress?: Address } = {}) {
  const programAddress = config.programAddress ?? AGENT_RAILS_PROGRAM_ADDRESS;
  return getProgramDerivedAddress({
    programAddress,
    seeds: [bytesEncoder.encode(new TextEncoder().encode("__event_authority"))],
  });
}

export type AssociatedTokenAddressInput = {
  owner: Address;
  mint: Address;
  tokenProgram?: Address;
};

export async function findAssociatedTokenAddress(input: AssociatedTokenAddressInput) {
  const tokenProgram = input.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
  return getProgramDerivedAddress({
    programAddress: ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
    seeds: [
      addressEncoder.encode(input.owner),
      addressEncoder.encode(tokenProgram),
      addressEncoder.encode(input.mint),
    ],
  });
}
