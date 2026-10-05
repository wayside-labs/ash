import { findSolVaultPda } from "@ash/client";
import type { Address, TransactionSigner } from "@solana/kit";
import { transferSol } from "../rpc.js";

export async function buildDepositInstructions(
  wallet: TransactionSigner,
  treasury: Address,
  lamports: bigint,
) {
  const [solVault] = await findSolVaultPda({ treasury });
  return [transferSol(wallet, solVault, lamports)];
}
