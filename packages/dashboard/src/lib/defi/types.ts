import type { DeFiIntentProposal } from "@agent-rails/contract/defi-intents";
import type { SolanaCluster } from "@/lib/schema";

export type AnalyzeDeFiIntentResult = {
  proposal: DeFiIntentProposal;
  treasuryAddress: string | null;
  cluster: SolanaCluster;
};
