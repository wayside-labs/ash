import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
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

const addressEncoder = getAddressEncoder();

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
