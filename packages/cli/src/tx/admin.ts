import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  getAddGuardianInstruction,
  getRemoveGuardianInstruction,
  getRemoveMintInstructionAsync,
  getSetRolesInstruction,
} from "@agent-rails/client";
import { NATIVE_MINT } from "@agent-rails/contract/constants";
import {
  type Address,
  address,
  none,
  type Option,
  some,
  type TransactionSigner,
} from "@solana/kit";
import { findEventAuthority } from "../bootstrap.js";

/**
 * Treasury-shape changes: who holds a role, and which mints the treasury accepts.
 *
 * All owner-only, and that is not an accident of the current implementation — an operator
 * who could appoint a guardian, or delist a mint out from under a policy, would be able to
 * widen what an agent can do without the owner ever signing (ADR-002).
 */

export async function buildAddGuardianInstruction(input: {
  owner: TransactionSigner;
  treasury: Address;
  guardian: Address;
}) {
  return getAddGuardianInstruction({
    owner: input.owner,
    treasury: input.treasury,
    eventAuthority: await findEventAuthority(),
    program: AGENT_RAILS_PROGRAM_ADDRESS,
    guardian: input.guardian,
  });
}

export async function buildRemoveGuardianInstruction(input: {
  owner: TransactionSigner;
  treasury: Address;
  guardian: Address;
}) {
  return getRemoveGuardianInstruction({
    owner: input.owner,
    treasury: input.treasury,
    eventAuthority: await findEventAuthority(),
    program: AGENT_RAILS_PROGRAM_ADDRESS,
    guardian: input.guardian,
  });
}

/**
 * `set_roles` takes both fields every time, each optional. Passing `none()` for one leaves
 * it alone — the program reads an absent field as "unchanged", which is why this builder
 * refuses to be called with neither: a transaction that changes nothing still costs a fee
 * and still reads, in an explorer, like the owner did something.
 */
export async function buildSetRolesInstruction(input: {
  owner: TransactionSigner;
  treasury: Address;
  newOwner?: Address;
  newOperator?: Address;
}) {
  const newOwner: Option<Address> = input.newOwner ? some(input.newOwner) : none();
  const newOperator: Option<Address> = input.newOperator ? some(input.newOperator) : none();
  return getSetRolesInstruction({
    owner: input.owner,
    treasury: input.treasury,
    eventAuthority: await findEventAuthority(),
    program: AGENT_RAILS_PROGRAM_ADDRESS,
    newOwner,
    newOperator,
  });
}

/**
 * `remove_mint` wants the vault account whose emptiness it is about to check: the vault ATA
 * for a token, the `sol_vault` PDA for native SOL. The program will not delist a mint whose
 * vault still holds a balance, so the account has to be named for that check to happen at
 * all — which is the difference between "delist" and "forget about the money".
 */
export async function buildRemoveMintInstruction(input: {
  owner: TransactionSigner;
  treasury: Address;
  mint: Address;
  vaultAta?: Address;
  solVault: Address;
}) {
  const isNative = input.mint === address(NATIVE_MINT);
  return getRemoveMintInstructionAsync({
    owner: input.owner,
    treasury: input.treasury,
    mint: input.mint,
    ...(isNative ? { solVault: input.solVault } : {}),
    ...(!isNative && input.vaultAta ? { vaultAta: input.vaultAta } : {}),
    eventAuthority: await findEventAuthority(),
    program: AGENT_RAILS_PROGRAM_ADDRESS,
  });
}
