import { AGENT_RAILS_PROGRAM_ADDRESS, getWithdrawInstructionAsync } from "@agent-rails/client";
import { NATIVE_MINT } from "@agent-rails/contract";
import { findAssociatedTokenAddress } from "@agent-rails/sdk";
import { type Address, address, type TransactionSigner } from "@solana/kit";
import { findEventAuthority, NATIVE_MINT_ADDRESS } from "../bootstrap.js";
import type { Rpc } from "../rpc.js";
import { readMint } from "../token.js";

export async function buildWithdrawInstruction(input: {
  rpc: Rpc;
  owner: TransactionSigner;
  treasury: Address;
  amount: bigint;
  destination: Address;
  mint?: Address;
}) {
  const eventAuthority = await findEventAuthority();
  const mint = input.mint ?? NATIVE_MINT_ADDRESS;

  if (mint === NATIVE_MINT_ADDRESS || mint === address(NATIVE_MINT)) {
    return getWithdrawInstructionAsync({
      owner: input.owner,
      treasury: input.treasury,
      mint: address(NATIVE_MINT),
      destination: input.destination,
      eventAuthority,
      program: AGENT_RAILS_PROGRAM_ADDRESS,
      amount: input.amount,
    });
  }

  const info = await readMint(input.rpc, mint, input.treasury);
  const [destinationAta] = await findAssociatedTokenAddress({
    owner: input.destination,
    mint: info.mint,
    tokenProgram: info.tokenProgram,
  });

  return getWithdrawInstructionAsync({
    owner: input.owner,
    treasury: input.treasury,
    mint: info.mint,
    vaultAta: info.vaultAta,
    destination: destinationAta,
    tokenProgram: info.tokenProgram,
    eventAuthority,
    program: AGENT_RAILS_PROGRAM_ADDRESS,
    amount: input.amount,
  });
}
