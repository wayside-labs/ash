/**
 * Curated Solana ecosystem map for workstations, mandate allowlists, and operator docs.
 * Addresses are mainnet program ids unless noted; devnet desks use operator-controlled wallets.
 */

export type DappCategory =
  | "aggregator"
  | "amm"
  | "lending"
  | "perps"
  | "oracle"
  | "rpc"
  | "payments"
  | "cross-chain";

export type IntegrationKind =
  | "mcp-jupiter"
  | "mcp-sodax"
  | "mcp-vendor"
  | "delegation"
  | "desk-wallet"
  | "mandate-allowlist";

export type IntegrationStatus = "live" | "planned" | "catalog-only";

export type SolanaDappIntegration = {
  kind: IntegrationKind;
  status: IntegrationStatus;
  /** One line for operators: how ASH composes with this protocol today. */
  hint: string;
};

export type SolanaDapp = {
  id: string;
  name: string;
  category: DappCategory;
  website: string;
  /** Primary on-chain programs (mainnet). Used for documentation and future mandate allowlists. */
  programIds: readonly string[];
  integration: SolanaDappIntegration;
};

/** Well-known programs referenced by the workstation catalog. */
export const PROGRAM_IDS = {
  jupiterAggregatorV6: "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  raydiumAmmV4: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
  orcaWhirlpool: "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyC",
  kaminoLend: "KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD",
  driftV2: "dRiftyHA39MWEi3m9aunc5MzRF1JYuBsbn6VPcn33PD",
  sodaxAssetManager: "AnCCJjheynmGqPp6Vgat9DTirGKD4CtQzP8cwTYV8qKH",
  sodaxIntentFiller: "ABBqXPEtnEnT2QywyRcpmwqHnGFXCpRSspL2Y4dB7YMA",
} as const;

/**
 * Order is display order for catalogs, not a ranking. Raydium and Orca are reached in practice
 * through Jupiter routing; they are listed so operators know which programs appear in swaps.
 */
export const SOLANA_DAPPS: readonly SolanaDapp[] = [
  {
    id: "jupiter",
    name: "Jupiter",
    category: "aggregator",
    website: "https://jup.ag",
    programIds: [PROGRAM_IDS.jupiterAggregatorV6],
    integration: {
      kind: "mcp-jupiter",
      status: "live",
      hint: "Quote and build swap transactions via @ash/integrations; fund moves through execute_payment to a desk wallet or native allowance.",
    },
  },
  {
    id: "sodax",
    name: "SODAX",
    category: "cross-chain",
    website: "https://sodax.com",
    programIds: [PROGRAM_IDS.sodaxAssetManager, PROGRAM_IDS.sodaxIntentFiller],
    integration: {
      kind: "mcp-sodax",
      status: "live",
      hint: "Cross-network swaps, bridge, money market and leverage-yield vaults via @ash/integrations (mcp sodax): unsigned intents for a desk wallet, recipients limited to the operator's SODAX_ALLOWED_DESTINATIONS. Mainnet only.",
    },
  },
  {
    id: "raydium",
    name: "Raydium",
    category: "amm",
    website: "https://raydium.io",
    programIds: [PROGRAM_IDS.raydiumAmmV4],
    integration: {
      kind: "mandate-allowlist",
      status: "catalog-only",
      hint: "Pools are reached via Jupiter or a desk wallet you control. Do not allowlist pool vault token accounts as payment destinations.",
    },
  },
  {
    id: "orca",
    name: "Orca",
    category: "amm",
    website: "https://www.orca.so",
    programIds: [PROGRAM_IDS.orcaWhirlpool],
    integration: {
      kind: "mandate-allowlist",
      status: "catalog-only",
      hint: "Whirlpool routes typically flow through Jupiter; same desk-wallet pattern as Raydium.",
    },
  },
  {
    id: "kamino",
    name: "Kamino",
    category: "lending",
    website: "https://kamino.finance",
    programIds: [PROGRAM_IDS.kaminoLend],
    integration: {
      kind: "desk-wallet",
      status: "planned",
      hint: "See examples/templates/defi-yield-rebalance: pay a labelled desk, deposit from the desk separately.",
    },
  },
  {
    id: "drift",
    name: "Drift",
    category: "perps",
    website: "https://drift.trade",
    programIds: [PROGRAM_IDS.driftV2],
    integration: {
      kind: "delegation",
      status: "planned",
      hint: "Delegated accounts: protocol holds custody; ASH governs allocation into the mandate wallet.",
    },
  },
] as const;

export function getSolanaDapp(id: string): SolanaDapp | undefined {
  return SOLANA_DAPPS.find((row) => row.id === id);
}

export function listSolanaDappsByCategory(category: DappCategory): SolanaDapp[] {
  return SOLANA_DAPPS.filter((row) => row.category === category);
}
