import { ASH_PROGRAM_ADDRESS, getPauseInstruction, getUnpauseInstruction } from "@ash/client";
import type { Address, TransactionSigner } from "@solana/kit";
import { findEventAuthority } from "../bootstrap.js";

export async function buildPauseInstruction(authority: TransactionSigner, treasury: Address) {
  const eventAuthority = await findEventAuthority();
  return getPauseInstruction({
    authority,
    treasury,
    eventAuthority,
    program: ASH_PROGRAM_ADDRESS,
  });
}

export async function buildUnpauseInstruction(owner: TransactionSigner, treasury: Address) {
  const eventAuthority = await findEventAuthority();
  return getUnpauseInstruction({
    owner,
    treasury,
    eventAuthority,
    program: ASH_PROGRAM_ADDRESS,
  });
}
