import {
  ASH_PROGRAM_ADDRESS,
  findEntryPda,
  getAddAllowlistEntryInstruction,
  getRemoveAllowlistEntryInstruction,
} from "@ash/client";
import type { Address, TransactionSigner } from "@solana/kit";
import { findEventAuthority } from "../bootstrap.js";
import { encodeFixedName } from "../names.js";

export async function buildAddAllowlistEntryInstruction(input: {
  operator: TransactionSigner;
  treasury: Address;
  policy: Address;
  destinationOwner: Address;
  label: string;
}) {
  const eventAuthority = await findEventAuthority();
  const [entry] = await findEntryPda({
    policy: input.policy,
    destinationOwner: input.destinationOwner,
  });
  return {
    entry,
    instruction: getAddAllowlistEntryInstruction({
      operator: input.operator,
      treasury: input.treasury,
      policy: input.policy,
      entry,
      eventAuthority,
      program: ASH_PROGRAM_ADDRESS,
      destinationOwner: input.destinationOwner,
      label: encodeFixedName(input.label, "--label"),
      perTxMaxOverride: 0n,
    }),
  };
}

export async function buildRemoveAllowlistEntryInstruction(input: {
  operator: TransactionSigner;
  treasury: Address;
  policy: Address;
  destinationOwner: Address;
}) {
  const eventAuthority = await findEventAuthority();
  const [entry] = await findEntryPda({
    policy: input.policy,
    destinationOwner: input.destinationOwner,
  });
  return getRemoveAllowlistEntryInstruction({
    operator: input.operator,
    treasury: input.treasury,
    policy: input.policy,
    entry,
    rentDestination: input.operator.address,
    eventAuthority,
    program: ASH_PROGRAM_ADDRESS,
  });
}
