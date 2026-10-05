import {
  ASH_PROGRAM_ADDRESS,
  getCreatePolicyInstruction,
  getUpdatePolicyInstruction,
  type PolicyInput,
} from "@ash/client";
import type { Address, TransactionSigner } from "@solana/kit";
import { findEventAuthority } from "../bootstrap.js";
import { encodeFixedName } from "../names.js";

export async function buildPolicyWriteInstruction(input: {
  operator: TransactionSigner;
  treasury: Address;
  policy: Address;
  policyName: string;
  args: PolicyInput;
  exists: boolean;
}) {
  const eventAuthority = await findEventAuthority();
  const name = encodeFixedName(input.policyName, "--policy-name");
  if (!input.exists) {
    return getCreatePolicyInstruction({
      operator: input.operator,
      treasury: input.treasury,
      policy: input.policy,
      eventAuthority,
      program: ASH_PROGRAM_ADDRESS,
      name,
      args: input.args,
    });
  }
  return getUpdatePolicyInstruction({
    operator: input.operator,
    treasury: input.treasury,
    policy: input.policy,
    eventAuthority,
    program: ASH_PROGRAM_ADDRESS,
    args: input.args,
  });
}
