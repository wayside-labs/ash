import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  getClosePolicyInstruction,
  getCloseReceiptInstruction,
  getCloseTreasuryInstructionAsync,
} from "@agent-rails/client";
import type { Address, TransactionSigner } from "@solana/kit";
import { findEventAuthority } from "../bootstrap.js";

/**
 * Rent reclamation. Every one of these refuses unless the account is already finished with
 * — a policy with live sessions, a treasury with a funded vault and a receipt inside its
 * grace period all stay put — so the guard rails live in the program and this file only has
 * to name the rent destination correctly.
 */

export async function buildClosePolicyInstruction(input: {
  operator: TransactionSigner;
  treasury: Address;
  policy: Address;
  rentDestination?: Address;
}) {
  return getClosePolicyInstruction({
    operator: input.operator,
    treasury: input.treasury,
    policy: input.policy,
    rentDestination: input.rentDestination ?? input.operator.address,
    eventAuthority: await findEventAuthority(),
    program: AGENT_RAILS_PROGRAM_ADDRESS,
  });
}

export async function buildCloseTreasuryInstruction(input: {
  owner: TransactionSigner;
  treasury: Address;
  solVault: Address;
  rentDestination?: Address;
}) {
  return getCloseTreasuryInstructionAsync({
    owner: input.owner,
    treasury: input.treasury,
    solVault: input.solVault,
    rentDestination: input.rentDestination ?? input.owner.address,
    eventAuthority: await findEventAuthority(),
    program: AGENT_RAILS_PROGRAM_ADDRESS,
  });
}

/**
 * Anyone may close an expired receipt, and the rent goes back to whoever paid for it rather
 * than to whoever closed it — which is why `feePayer` is read off the receipt instead of
 * being a parameter the caller chooses.
 */
export async function buildCloseReceiptInstruction(input: {
  anyone: TransactionSigner;
  receipt: Address;
  feePayer: Address;
}) {
  return getCloseReceiptInstruction({
    anyone: input.anyone,
    receipt: input.receipt,
    feePayer: input.feePayer,
    eventAuthority: await findEventAuthority(),
    program: AGENT_RAILS_PROGRAM_ADDRESS,
  });
}
