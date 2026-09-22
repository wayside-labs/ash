import { z } from "zod";

/**
 * Curated Solana DeFi intents — advisory layer only.
 *
 * Agent Rails still executes `execute_payment` / `execute_payment_sol` on-chain.
 * These types describe what an owner-approved mandate would look like before any
 * protocol MCP or executor agent exists. Nothing here widens session or policy limits.
 */

export const DEFI_PIPELINE_PHASES = [
  "discover",
  "evaluate",
  "mandate",
  "approve",
  "execute",
] as const;

export type DeFiPipelinePhase = (typeof DEFI_PIPELINE_PHASES)[number];

export const DEFI_INTENT_KINDS = [
  "swap",
  "add_liquidity",
  "remove_liquidity",
  "lend",
  "borrow",
  "stake",
  "unstake",
  "perp_trade",
  "yield_mandate",
] as const;

export type DeFiIntentKind = (typeof DEFI_INTENT_KINDS)[number];

export const DEFI_PROTOCOL_CATEGORIES = [
  "aggregator",
  "amm",
  "clmm",
  "lending",
  "liquid_staking",
  "perpetuals",
  "orderbook",
  "nft_marketplace",
] as const;

export type DeFiProtocolCategory = (typeof DEFI_PROTOCOL_CATEGORIES)[number];

export const DEFI_RISK_TIERS = ["low", "medium", "high", "experimental"] as const;
export type DeFiRiskTier = (typeof DEFI_RISK_TIERS)[number];

export type DeFiProtocol = {
  id: string;
  name: string;
  category: DeFiProtocolCategory;
  riskTier: DeFiRiskTier;
  /** Suggested allowlist label prefix for future program/ vault destinations. */
  allowlistLabel: string;
  supportedIntents: readonly DeFiIntentKind[];
  aliases: readonly string[];
  website: string;
  /** Whether v1 expects a dedicated MCP / read integration before Execute. */
  requiresProtocolMcp: boolean;
  notes: string;
};

/** Major Solana DeFi protocols — curated, not exhaustive. */
export const SOLANA_DEFI_PROTOCOLS: Readonly<Record<string, DeFiProtocol>> = Object.freeze({
  jupiter: {
    id: "jupiter",
    name: "Jupiter",
    category: "aggregator",
    riskTier: "medium",
    allowlistLabel: "jupiter",
    supportedIntents: ["swap"],
    aliases: ["jupiter", "jup", "jup.ag"],
    website: "https://jup.ag",
    requiresProtocolMcp: true,
    notes: "Route swaps across Solana liquidity; slippage and MEV are not guaranteed.",
  },
  meteora: {
    id: "meteora",
    name: "Meteora",
    category: "clmm",
    riskTier: "medium",
    allowlistLabel: "meteora",
    supportedIntents: ["add_liquidity", "remove_liquidity", "swap"],
    aliases: ["meteora", "meteora dlmm", "dlmm"],
    website: "https://meteora.ag",
    requiresProtocolMcp: true,
    notes: "DLMM / dynamic pools; IL and fee tier depend on pool selection.",
  },
  kamino: {
    id: "kamino",
    name: "Kamino",
    category: "lending",
    riskTier: "medium",
    allowlistLabel: "kamino",
    supportedIntents: ["lend", "borrow", "add_liquidity"],
    aliases: ["kamino", "kamino finance", "kamino lend"],
    website: "https://kamino.finance",
    requiresProtocolMcp: true,
    notes: "Lending and structured vaults; APY is variable and not guaranteed.",
  },
  marginfi: {
    id: "marginfi",
    name: "Marginfi",
    category: "lending",
    riskTier: "medium",
    allowlistLabel: "marginfi",
    supportedIntents: ["lend", "borrow"],
    aliases: ["marginfi", "margin fi", "mrgn"],
    website: "https://marginfi.com",
    requiresProtocolMcp: true,
    notes: "Money-market style lending; utilization spikes can block exits.",
  },
  solend: {
    id: "solend",
    name: "Solend",
    category: "lending",
    riskTier: "medium",
    allowlistLabel: "solend",
    supportedIntents: ["lend", "borrow"],
    aliases: ["solend", "slnd"],
    website: "https://solend.fi",
    requiresProtocolMcp: true,
    notes: "Legacy lending market; verify pool oracle and reserve status live.",
  },
  raydium: {
    id: "raydium",
    name: "Raydium",
    category: "amm",
    riskTier: "medium",
    allowlistLabel: "raydium",
    supportedIntents: ["swap", "add_liquidity", "remove_liquidity"],
    aliases: ["raydium", "ray"],
    website: "https://raydium.io",
    requiresProtocolMcp: true,
    notes: "AMM + concentrated liquidity; pool-specific IL risk.",
  },
  orca: {
    id: "orca",
    name: "Orca",
    category: "clmm",
    riskTier: "medium",
    allowlistLabel: "orca",
    supportedIntents: ["swap", "add_liquidity", "remove_liquidity"],
    aliases: ["orca", "orca whirlpool", "whirlpool"],
    website: "https://www.orca.so",
    requiresProtocolMcp: true,
    notes: "Whirlpools CLMM; tick range and IL must be explicit in mandate.",
  },
  drift: {
    id: "drift",
    name: "Drift",
    category: "perpetuals",
    riskTier: "high",
    allowlistLabel: "drift",
    supportedIntents: ["perp_trade", "lend", "borrow"],
    aliases: ["drift", "drift protocol", "drift trade"],
    website: "https://www.drift.trade",
    requiresProtocolMcp: true,
    notes: "Perps and spot margin; liquidation risk — default quarantine for agents.",
  },
  phoenix: {
    id: "phoenix",
    name: "Phoenix",
    category: "orderbook",
    riskTier: "high",
    allowlistLabel: "phoenix",
    supportedIntents: ["swap", "perp_trade"],
    aliases: ["phoenix", "ellipsis", "phoenix trade"],
    website: "https://www.phoenix.trade",
    requiresProtocolMcp: true,
    notes: "On-chain order book; partial fills and latency matter for agents.",
  },
  marinade: {
    id: "marinade",
    name: "Marinade",
    category: "liquid_staking",
    riskTier: "low",
    allowlistLabel: "marinade",
    supportedIntents: ["stake", "unstake"],
    aliases: ["marinade", "msol", "mSOL"],
    website: "https://marinade.finance",
    requiresProtocolMcp: true,
    notes: "Liquid staking to mSOL; depeg and unstake delay are mandate fields.",
  },
  jito: {
    id: "jito",
    name: "Jito",
    category: "liquid_staking",
    riskTier: "low",
    allowlistLabel: "jito",
    supportedIntents: ["stake", "unstake"],
    aliases: ["jito", "jitosol", "jito sol"],
    website: "https://www.jito.wtf",
    requiresProtocolMcp: true,
    notes: "MEV-enabled LST; reward rate varies with network activity.",
  },
  sanctum: {
    id: "sanctum",
    name: "Sanctum",
    category: "liquid_staking",
    riskTier: "medium",
    allowlistLabel: "sanctum",
    supportedIntents: ["stake", "unstake", "swap"],
    aliases: ["sanctum", "sanctum infinity", "inf"],
    website: "https://www.sanctum.so",
    requiresProtocolMcp: true,
    notes: "LST routing and INF; pool composition must be in risk card.",
  },
  tensor: {
    id: "tensor",
    name: "Tensor",
    category: "nft_marketplace",
    riskTier: "high",
    allowlistLabel: "tensor",
    supportedIntents: ["swap"],
    aliases: ["tensor", "tensor trade", "tensorswap"],
    website: "https://www.tensor.trade",
    requiresProtocolMcp: true,
    notes: "NFT marketplace; floor volatility — outside typical treasury yield flows.",
  },
});

export const DEFI_REASON_CODES = {
  GUARANTEED_YIELD_REQUEST: "GUARANTEED_YIELD_REQUEST",
  UNREALISTIC_RETURN_TARGET: "UNREALISTIC_RETURN_TARGET",
  AUTONOMOUS_DEFI_BLOCKED: "AUTONOMOUS_DEFI_BLOCKED",
  STALE_YIELD_DATA: "STALE_YIELD_DATA",
  CAPABILITY_GAP: "CAPABILITY_GAP",
  UNKNOWN_PROTOCOL: "UNKNOWN_PROTOCOL",
  PROTOCOL_NOT_ALLOWLISTED: "PROTOCOL_NOT_ALLOWLISTED",
  TREASURY_PAUSED: "TREASURY_PAUSED",
  EXCEEDS_POLICY_HEADROOM: "EXCEEDS_POLICY_HEADROOM",
  HIGH_RISK_QUARANTINE: "HIGH_RISK_QUARANTINE",
} as const;

export type DeFiReasonCode = (typeof DEFI_REASON_CODES)[keyof typeof DEFI_REASON_CODES];

export type DeFiBlockedPattern = {
  code: DeFiReasonCode;
  matched: string;
  message: string;
};

const GUARANTEED_YIELD_PATTERNS: readonly { re: RegExp; code: DeFiReasonCode; message: string }[] =
  [
    {
      re: /\b(guaranteed|guarantee|risk[- ]?free|sem risco|garantido|garantia)\b/i,
      code: DEFI_REASON_CODES.GUARANTEED_YIELD_REQUEST,
      message: "Yield cannot be guaranteed on-chain or by Agent Rails.",
    },
    {
      re: /\b(\d{2,3})\s*%\s*(profit|return|yield|apy|lucro|retorno)\b/i,
      code: DEFI_REASON_CODES.UNREALISTIC_RETURN_TARGET,
      message: "Very high return targets require explicit owner mandate, not autonomous agents.",
    },
    {
      re: /\b(in|within|em|dentro de)\s*(\d+)\s*(h|hr|hour|hours|hora|horas|day|days|dia|dias)\b/i,
      code: DEFI_REASON_CODES.GUARANTEED_YIELD_REQUEST,
      message: "Time-boxed profit promises are not valid authorization.",
    },
    {
      re: /\b(50\s*%\s*(in|em|within)?\s*48\s*h)/i,
      code: DEFI_REASON_CODES.GUARANTEED_YIELD_REQUEST,
      message: "Short-horizon profit guarantees are refused for autonomous execution.",
    },
  ];

export type ParsedDeFiIntent = {
  rawText: string;
  kind: DeFiIntentKind | null;
  protocol: DeFiProtocol | null;
  assetSymbol: string | null;
  amountHint: string | null;
  apyThresholdPct: number | null;
  blockedPatterns: DeFiBlockedPattern[];
};

export type DeFiTreasurySnapshot = {
  paused: boolean;
  /** Mint address → raw base units as decimal string. */
  mintBalances: Readonly<Record<string, string>>;
  /** Mint address → per-tx max raw base units. */
  perTxMaxByMint: Readonly<Record<string, string>>;
  allowlistLabels: readonly string[];
  activeSessions: number;
};

export type DeFiPreflightCheck = {
  ok: boolean;
  code: DeFiReasonCode | null;
  detail: string;
};

export type DeFiIntentProposal = {
  parsed: ParsedDeFiIntent;
  phases: DeFiPipelinePhase[];
  /** Phases the owner must complete before any executor agent runs. */
  requiredOwnerSteps: string[];
  preflight: DeFiPreflightCheck[];
  autonomousExecutionAllowed: boolean;
  quarantineRecommended: boolean;
  ownerChecklist: string[];
  suggestedAllowlistLabels: string[];
  riskCardTemplate: Record<string, string | number | string[] | null>;
};

const INTENT_KIND_PATTERNS: readonly { kind: DeFiIntentKind; re: RegExp }[] = [
  { kind: "swap", re: /\b(swap|troca|exchange|trade)\b/i },
  { kind: "add_liquidity", re: /\b(add|provide|deposit)\s+(lp|liquidity|liquidez)\b/i },
  { kind: "remove_liquidity", re: /\b(remove|withdraw)\s+(lp|liquidity|liquidez)\b/i },
  { kind: "lend", re: /\b(lend|supply|deposit)\b/i },
  { kind: "borrow", re: /\b(borrow|loan|emprest)\b/i },
  { kind: "stake", re: /\b(stake|staking|stakear)\b/i },
  { kind: "unstake", re: /\b(unstake|unstaking)\b/i },
  { kind: "perp_trade", re: /\b(perp|perpetual|short|long|leverage|alavancagem)\b/i },
  { kind: "yield_mandate", re: /\b(yield|apy|tvl|lucro|retorno)\b/i },
];

const ASSET_PATTERN =
  /\b(usdc|sol|msol|jitosol|jito\s*sol|usdt|bonk|jup|ray|orca)\b|\$\s*([\d,.]+[kKmM]?)/i;
const APY_PATTERN = /(?:apy|yield|retorno)\s*[>≥]?\s*(\d+(?:\.\d+)?)\s*%/i;
const AMOUNT_PATTERN = /(?:\$|usd\s*)?([\d,.]+)\s*(?:k|m)?\s*(?:usdc|usd|sol|dollars?|dolares?)?/i;

export function listDeFiProtocols(): DeFiProtocol[] {
  return Object.values(SOLANA_DEFI_PROTOCOLS);
}

export function getDeFiProtocol(id: string): DeFiProtocol | null {
  return SOLANA_DEFI_PROTOCOLS[id] ?? null;
}

export function findProtocolInText(text: string): DeFiProtocol | null {
  const lower = text.toLowerCase();
  for (const protocol of listDeFiProtocols()) {
    for (const alias of protocol.aliases) {
      if (lower.includes(alias.toLowerCase())) return protocol;
    }
  }
  return null;
}

export function detectBlockedPatterns(text: string): DeFiBlockedPattern[] {
  const hits: DeFiBlockedPattern[] = [];
  for (const { re, code, message } of GUARANTEED_YIELD_PATTERNS) {
    const match = text.match(re);
    if (match) {
      hits.push({ code, matched: match[0], message });
    }
  }
  return hits;
}

function detectIntentKind(text: string): DeFiIntentKind | null {
  for (const { kind, re } of INTENT_KIND_PATTERNS) {
    if (re.test(text)) return kind;
  }
  return null;
}

function detectAssetSymbol(text: string): string | null {
  const match = text.match(ASSET_PATTERN);
  if (!match) return null;
  const token = match[1] ?? match[2];
  if (!token) return null;
  if (token.startsWith("$")) return "USD";
  return token.toUpperCase().replace(/\s+/g, "");
}

function detectApyThreshold(text: string): number | null {
  const match = text.match(APY_PATTERN);
  if (!match?.[1]) return null;
  const value = Number.parseFloat(match[1]);
  return Number.isFinite(value) ? value : null;
}

function detectAmountHint(text: string): string | null {
  const match = text.match(AMOUNT_PATTERN);
  return match?.[1] ?? null;
}

export function parseDeFiIntentRequest(text: string): ParsedDeFiIntent {
  const blockedPatterns = detectBlockedPatterns(text);
  const protocol = findProtocolInText(text);
  let kind = detectIntentKind(text);
  if (!kind && blockedPatterns.length > 0) kind = "yield_mandate";
  if (!kind && protocol) {
    kind = protocol.supportedIntents[0] ?? "yield_mandate";
  }

  return {
    rawText: text,
    kind,
    protocol,
    assetSymbol: detectAssetSymbol(text),
    amountHint: detectAmountHint(text),
    apyThresholdPct: detectApyThreshold(text),
    blockedPatterns,
  };
}

function defaultOwnerSteps(parsed: ParsedDeFiIntent): string[] {
  const steps = [
    "Complete Discover phase with live protocol read MCP (APY, TVL, utilization, data_age_s ≤ 300).",
    "Fill risk card with all required fields before Mandate.",
    "Owner signs mandate: amount caps, min APY (if any), stop conditions, single-protocol cap ≤ 20% vault.",
  ];
  if (parsed.protocol?.requiresProtocolMcp) {
    steps.push(
      `Install and enable read MCP for ${parsed.protocol.name} (not yet bundled in Agent Rails).`,
    );
  }
  steps.push("Add allowlist labels for protocol vaults/programs; tighten policy ≤ owner ceiling.");
  steps.push("Create time-boxed executor session; guardian pause remains available.");
  return steps;
}

function buildOwnerChecklist(
  parsed: ParsedDeFiIntent,
  treasury: DeFiTreasurySnapshot | null,
): string[] {
  const checklist: string[] = [];
  if (treasury?.paused) {
    checklist.push("Unpause treasury or execute only after owner review while paused.");
  }
  if (parsed.protocol) {
    const label = parsed.protocol.allowlistLabel;
    const listed = treasury?.allowlistLabels.some((l) =>
      l.toLowerCase().includes(label.toLowerCase()),
    );
    if (!listed) {
      checklist.push(`Allowlist destinations for "${label}" (program pools / vault PDAs).`);
    }
  } else {
    checklist.push("Name target protocol in mandate; unknown protocols stay in Design Mode.");
  }
  checklist.push(
    "Never route chat assistant to execute_payment — executor agent + owner session only.",
  );
  if (parsed.blockedPatterns.length > 0) {
    checklist.push(
      "Reject guaranteed-yield framing; restate as conditional mandate with abort conditions.",
    );
  }
  return checklist;
}

export function preflightDeFiIntent(
  parsed: ParsedDeFiIntent,
  treasury: DeFiTreasurySnapshot | null,
): DeFiPreflightCheck[] {
  const checks: DeFiPreflightCheck[] = [];

  for (const block of parsed.blockedPatterns) {
    checks.push({ ok: false, code: block.code, detail: block.message });
  }

  if (parsed.blockedPatterns.some((b) => b.code === DEFI_REASON_CODES.GUARANTEED_YIELD_REQUEST)) {
    checks.push({
      ok: false,
      code: DEFI_REASON_CODES.AUTONOMOUS_DEFI_BLOCKED,
      detail: "Autonomous agents cannot act on guaranteed-yield requests.",
    });
  }

  if (treasury?.paused) {
    checks.push({
      ok: false,
      code: DEFI_REASON_CODES.TREASURY_PAUSED,
      detail: "Treasury is paused; DeFi execute phase blocked until owner unpause.",
    });
  }

  if (parsed.protocol) {
    if (
      parsed.kind &&
      !parsed.protocol.supportedIntents.includes(parsed.kind) &&
      parsed.kind !== "yield_mandate"
    ) {
      checks.push({
        ok: false,
        code: DEFI_REASON_CODES.CAPABILITY_GAP,
        detail: `${parsed.protocol.name} does not support intent "${parsed.kind}" in the curated catalog.`,
      });
    }
    const label = parsed.protocol.allowlistLabel.toLowerCase();
    const listed = treasury?.allowlistLabels.some((l) => l.toLowerCase().includes(label));
    if (treasury && !listed) {
      checks.push({
        ok: false,
        code: DEFI_REASON_CODES.PROTOCOL_NOT_ALLOWLISTED,
        detail: `No allowlist label matching "${parsed.protocol.allowlistLabel}".`,
      });
    }
    if (parsed.protocol.requiresProtocolMcp) {
      checks.push({
        ok: false,
        code: DEFI_REASON_CODES.CAPABILITY_GAP,
        detail: `${parsed.protocol.name} requires a protocol read MCP before Evaluate/Mandate.`,
      });
    }
    if (parsed.protocol.riskTier === "high" || parsed.protocol.riskTier === "experimental") {
      checks.push({
        ok: false,
        code: DEFI_REASON_CODES.HIGH_RISK_QUARANTINE,
        detail: `${parsed.protocol.name} is high-risk; quarantine executor rows until owner release.`,
      });
    }
  } else if (parsed.kind) {
    checks.push({
      ok: false,
      code: DEFI_REASON_CODES.UNKNOWN_PROTOCOL,
      detail: "Protocol not recognized in curated catalog; stay in Design Mode.",
    });
  }

  if (parsed.apyThresholdPct !== null && parsed.apyThresholdPct >= 30) {
    checks.push({
      ok: false,
      code: DEFI_REASON_CODES.UNREALISTIC_RETURN_TARGET,
      detail: `APY threshold ${parsed.apyThresholdPct}% is unusually high; requires explicit signed mandate.`,
    });
  }

  if (checks.length === 0) {
    checks.push({
      ok: true,
      code: null,
      detail: "Structural preflight passed; owner Mandate + Approve phases still required.",
    });
  }

  return checks;
}

export function buildDeFiIntentProposal(
  text: string,
  treasury: DeFiTreasurySnapshot | null = null,
): DeFiIntentProposal {
  const parsed = parseDeFiIntentRequest(text);
  const preflight = preflightDeFiIntent(parsed, treasury);
  const hasHardBlock = preflight.some(
    (c) =>
      !c.ok &&
      (c.code === DEFI_REASON_CODES.GUARANTEED_YIELD_REQUEST ||
        c.code === DEFI_REASON_CODES.AUTONOMOUS_DEFI_BLOCKED ||
        c.code === DEFI_REASON_CODES.TREASURY_PAUSED),
  );
  const quarantineRecommended = preflight.some(
    (c) => !c.ok && c.code === DEFI_REASON_CODES.HIGH_RISK_QUARANTINE,
  );

  const protocol = parsed.protocol;
  const suggestedAllowlistLabels = protocol ? [protocol.allowlistLabel] : [];

  return {
    parsed,
    phases: [...DEFI_PIPELINE_PHASES],
    requiredOwnerSteps: defaultOwnerSteps(parsed),
    preflight,
    autonomousExecutionAllowed: !hasHardBlock && parsed.blockedPatterns.length === 0,
    quarantineRecommended,
    ownerChecklist: buildOwnerChecklist(parsed, treasury),
    suggestedAllowlistLabels,
    riskCardTemplate: {
      protocol: protocol?.name ?? null,
      asset: parsed.assetSymbol,
      apy: null,
      apy_source: null,
      data_age_s: null,
      tvl: null,
      utilization_pct: null,
      single_protocol_cap_pct: 20,
      vault_deploy_pct: null,
      exit_assumption: null,
      unknowns: protocol ? [`Live ${protocol.name} read MCP not connected`] : ["Protocol TBD"],
    },
  };
}

/** Compact catalog for chat system context — names only, no invented APY. */
export function formatDeFiCatalogForPrompt(): string {
  const rows = listDeFiProtocols().map(
    (p) => `- ${p.name} (${p.category}, ${p.riskTier}): ${p.supportedIntents.join(", ")}`,
  );
  return [
    "Curated Solana DeFi protocols (Agent Rails payment floor unchanged):",
    ...rows,
    "DeFi execute path: Discover → Evaluate → Mandate → Owner Approve → Executor only.",
    "Guaranteed yield / short-horizon profit requests: refuse autonomous execution; draft mandate only.",
  ].join("\n");
}

export const defiAnalyzeRequestSchema = z.object({
  text: z.string().min(1).max(4000),
  treasuryAddress: z.string().nullable().default(null),
  cluster: z.enum(["devnet", "testnet", "mainnet-beta"]).default("devnet"),
  rpc: z.string().nullable().default(null),
});

export type DeFiAnalyzeRequest = z.infer<typeof defiAnalyzeRequestSchema>;
