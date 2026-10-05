import { ASH_PROGRAM_ADDRESS, getSetCeilingInstruction, type MintCeilingInput } from "@ash/client";
import type { Address, TransactionSigner } from "@solana/kit";
import { findEventAuthority } from "../bootstrap.js";

export async function buildSetCeilingInstruction(input: {
  owner: TransactionSigner;
  treasury: Address;
  mint: Address;
  ceiling: MintCeilingInput;
  allowAnyDestination: boolean;
  allowCreateDestinationAta: boolean;
}) {
  const eventAuthority = await findEventAuthority();
  return getSetCeilingInstruction({
    owner: input.owner,
    treasury: input.treasury,
    eventAuthority,
    program: ASH_PROGRAM_ADDRESS,
    mint: input.mint,
    ceiling: input.ceiling,
    allowAnyDestination: input.allowAnyDestination,
    allowCreateDestinationAta: input.allowCreateDestinationAta,
  });
}
