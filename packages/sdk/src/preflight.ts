import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";

export type PreflightInput = {
  rpc: Rpc<SolanaRpcApi>;
  session: Address;
};

/** Placeholder for simulate-before-send checks. Wired in a follow-up PR. */
export async function preflightPayment(_input: PreflightInput): Promise<void> {
  return;
}
