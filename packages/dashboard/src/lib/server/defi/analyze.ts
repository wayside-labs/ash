import { NATIVE_MINT } from "@agent-rails/contract/constants";
import {
  buildDeFiIntentProposal,
  type DeFiTreasurySnapshot,
} from "@agent-rails/contract/defi-intents";
import type { AnalyzeDeFiIntentResult } from "@/lib/defi/types";
import type { SolanaCluster } from "@/lib/schema";
import { getVaultBalances, readTreasury, type TreasuryView } from "@/lib/server/solana";

function treasuryToSnapshot(
  view: TreasuryView,
  vaultLamports: number | null,
): DeFiTreasurySnapshot {
  const perTxMaxByMint: Record<string, string> = {};
  for (const policy of view.policies) {
    for (const limit of policy.limits) {
      if (!perTxMaxByMint[limit.mint]) {
        perTxMaxByMint[limit.mint] = limit.perTxMax;
      }
    }
  }
  for (const ceiling of view.mints) {
    if (!perTxMaxByMint[ceiling.mint]) {
      perTxMaxByMint[ceiling.mint] = ceiling.maxPerTx;
    }
  }

  const mintBalances: Record<string, string> = {
    [NATIVE_MINT]: String(vaultLamports ?? view.solVaultLamports),
  };

  return {
    paused: view.paused,
    mintBalances,
    perTxMaxByMint,
    // Allowlist entries are not yet surfaced in TreasuryView; preflight treats empty as not allowlisted.
    allowlistLabels: [],
    activeSessions: view.activeSessions,
  };
}

export type { AnalyzeDeFiIntentResult } from "@/lib/defi/types";

export async function analyzeDeFiIntent(options: {
  text: string;
  cluster: SolanaCluster;
  rpc: string | null;
  treasuryAddress: string | null;
}): Promise<AnalyzeDeFiIntentResult> {
  const { text, cluster, rpc, treasuryAddress } = options;

  if (!treasuryAddress) {
    return {
      proposal: buildDeFiIntentProposal(text, null),
      treasuryAddress: null,
      cluster,
    };
  }

  const view = await readTreasury(cluster, rpc, treasuryAddress);
  if (!view) {
    return {
      proposal: buildDeFiIntentProposal(text, null),
      treasuryAddress,
      cluster,
    };
  }

  const balances = await getVaultBalances(cluster, rpc, [treasuryAddress]);
  const vault = balances.vaults.find((v) => v.treasury === treasuryAddress);
  const lamports = vault?.lamports ?? view.solVaultLamports;

  return {
    proposal: buildDeFiIntentProposal(text, treasuryToSnapshot(view, lamports)),
    treasuryAddress,
    cluster,
  };
}
