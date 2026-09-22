import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  getCloseSessionInstruction,
  getCreateSessionInstruction,
  getRevokeSessionInstruction,
} from "@agent-rails/client";
import { AUTH_MODE_DIRECT_SIGNER } from "@agent-rails/contract";
import type { Address, TransactionSigner } from "@solana/kit";
import { findEventAuthority } from "../bootstrap.js";
import { encodeFixedName } from "../names.js";

export async function buildCreateSessionInstruction(input: {
  operator: TransactionSigner;
  treasury: Address;
  policy: Address;
  session: Address;
  sessionKey: Address;
  label: string;
  expiresAt: bigint;
}) {
  const eventAuthority = await findEventAuthority();
  return getCreateSessionInstruction({
    operator: input.operator,
    treasury: input.treasury,
    policy: input.policy,
    session: input.session,
    eventAuthority,
    program: AGENT_RAILS_PROGRAM_ADDRESS,
    sessionKey: input.sessionKey,
    label: encodeFixedName(input.label, "--label"),
    expiresAt: input.expiresAt,
    authMode: AUTH_MODE_DIRECT_SIGNER,
  });
}

export async function buildRevokeSessionInstruction(input: {
  authority: TransactionSigner;
  treasury: Address;
  policy: Address;
  session: Address;
}) {
  const eventAuthority = await findEventAuthority();
  return getRevokeSessionInstruction({
    authority: input.authority,
    treasury: input.treasury,
    policy: input.policy,
    session: input.session,
    eventAuthority,
    program: AGENT_RAILS_PROGRAM_ADDRESS,
  });
}

export async function buildCloseSessionInstruction(input: {
  operator: TransactionSigner;
  treasury: Address;
  policy: Address;
  session: Address;
  rentDestination: Address;
}) {
  const eventAuthority = await findEventAuthority();
  return getCloseSessionInstruction({
    operator: input.operator,
    treasury: input.treasury,
    policy: input.policy,
    session: input.session,
    rentDestination: input.rentDestination,
    eventAuthority,
    program: AGENT_RAILS_PROGRAM_ADDRESS,
  });
}
