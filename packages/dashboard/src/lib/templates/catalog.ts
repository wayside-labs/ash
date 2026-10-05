import type { StoredWorkflowTemplate, TemplateAgentDef } from "@/lib/schema";

type WorkflowTemplate = StoredWorkflowTemplate;

export type BuiltinTemplateId =
  | "builtin:earn-bounty-hunter"
  | "builtin:dca-sol"
  | "builtin:defi-yield-rebalance"
  | "builtin:solana-workstation"
  | "builtin:cloak-private-payout";

/** Prefix for built-in ids so they never collide with stored `tpl_*` rows. */
export const BUILTIN_TEMPLATE_PREFIX = "builtin:";

const EARN_AGENTS: TemplateAgentDef[] = [
  { name: "Scout", role: "Earn scout", railsMcp: "none", dailyLimitUsd: 0, paysTo: [] },
  { name: "Research", role: "Bounty research", railsMcp: "none", dailyLimitUsd: 0, paysTo: [] },
  {
    name: "Builder",
    role: "Bounty builder",
    railsMcp: "full",
    dailyLimitUsd: 50,
    paysTo: ["RPC credits", "Inference", "Hosting"],
  },
];

const WORKSTATION_AGENTS: TemplateAgentDef[] = [
  {
    name: "Orchestrator",
    role: "Workstation lead",
    railsMcp: "readonly",
    dailyLimitUsd: 0,
    paysTo: [],
  },
  {
    name: "Executor",
    role: "Capped on-chain executor",
    railsMcp: "full",
    dailyLimitUsd: 250,
    paysTo: ["Swap desk", "Vendor services"],
  },
  {
    name: "Analyst",
    role: "Research and quotes",
    railsMcp: "none",
    dailyLimitUsd: 0,
    paysTo: [],
  },
];

const YIELD_AGENTS: TemplateAgentDef[] = [
  { name: "Scout", role: "Rate scout", railsMcp: "none", dailyLimitUsd: 0, paysTo: [] },
  {
    name: "Planner",
    role: "Rebalance planner",
    railsMcp: "readonly",
    dailyLimitUsd: 0,
    paysTo: [],
  },
  {
    name: "Executor",
    role: "Capped executor",
    railsMcp: "full",
    dailyLimitUsd: 100,
    paysTo: ["Venue desk A", "Venue desk B"],
  },
];

/**
 * The "desk" is the operator's own mainnet wallet: nothing here is paid from the vault, which is
 * on devnet. `dailyLimitUsd` is the template's cap (0.10 SOL a run) rounded up, a label like the
 * others, not a limit anything enforces.
 */
const CLOAK_AGENTS: TemplateAgentDef[] = [
  {
    name: "Payout planner",
    role: "Drafts the payout list in chat; holds no keys",
    railsMcp: "none",
    dailyLimitUsd: 0,
    paysTo: [],
  },
  {
    name: "Cloak desk",
    role: "Your own wallet: shields, then pays privately through Cloak",
    railsMcp: "none",
    dailyLimitUsd: 15,
    paysTo: ["SOL payee", "ZEC payee"],
  },
];

/**
 * English copy for the server apply path and as the fallback when i18n keys are missing.
 * The templates page overlays locale strings from `templates.catalog.*`.
 */
export const BUILTIN_TEMPLATES: Record<BuiltinTemplateId, WorkflowTemplate> = {
  "builtin:earn-bounty-hunter": {
    id: "builtin:earn-bounty-hunter",
    name: "Earn bounty hunter",
    description: "Scout Superteam Earn, research a pick, build with capped vendor spend.",
    icon: "🎯",
    summary:
      "Three roles: scout and research never pay; only the builder spends on allowlisted vendors.",
    howItWorks: [
      "Scout lists up to three Earn bounties. Research writes a brief for the bounty you approve.",
      "The builder pays RPC, inference, and hosting through ASH — not a hot wallet.",
      "You submit on Earn; the agents never widen their own limits.",
    ].join("\n\n"),
    setupSteps: [
      "Run pnpm ash init for a devnet treasury and USDC/SOL policy.",
      "Add labelled destinations for RPC credits, inference, and hosting (dest add).",
      "Create one session per bounty for the Builder agent.",
      "Download per-agent MCP config from Agents → MCP (builder gets full rails tools).",
      "Approve which bounty to pursue before research starts.",
    ],
    agents: EARN_AGENTS,
    docsPath: "examples/templates/earn-bounty-hunter/README.md",
    createdAt: "2026-09-28T00:00:00.000Z",
  },
  "builtin:dca-sol": {
    id: "builtin:dca-sol",
    name: "DCA into SOL",
    description: "Scheduled USDC slices to an allowlisted swap desk — no model timer.",
    icon: "📅",
    summary: "Cron + ash pay moves a fixed amount each period; swaps happen from your desk wallet.",
    howItWorks: [
      "A treasury holds USDC. A cron script calls ash pay on a schedule.",
      "Each payment uses a reference tied to the period so retries cannot double-pay.",
      "The swap desk is an allowlisted owner you control; ASH does not swap on-chain.",
    ].join("\n\n"),
    setupSteps: [
      "Init treasury with token limits sized for your DCA amount.",
      "Allowlist the swap desk wallet (dest add --label swap-desk).",
      "Copy examples/templates/dca-sol/dca.env.example and set amounts and schedule.",
      "Install the cron entry from the template README.",
      "Use guardian-watch / alert-watch for denials.",
    ],
    agents: [],
    docsPath: "examples/templates/dca-sol/README.md",
    createdAt: "2026-09-28T00:00:00.000Z",
  },
  "builtin:defi-yield-rebalance": {
    id: "builtin:defi-yield-rebalance",
    name: "DeFi yield rebalance",
    description: "Scout rates, plan a capped move, executor pays venue desks only.",
    icon: "⚖️",
    summary: "Planner sees policy; executor spends up to cap on allowlisted per-venue desks.",
    howItWorks: [
      "A script or scout gathers rates. The planner proposes a rebalance within policy headroom.",
      "The executor pays USDC to labelled desk wallets — not protocol vaults (that would be a donation).",
      "Deposits into protocols are a separate human- or desk-signed step.",
    ].join("\n\n"),
    setupSteps: [
      "Init treasury and set conservative per-tx and daily USDC limits.",
      "Allowlist one desk wallet per venue you might use.",
      "Create sessions: planner readonly rails MCP, executor full.",
      "Run scout-rates.sh or your own feed; planner writes a proposal id for references.",
      "Human approves each rebalance before the executor pays.",
    ],
    agents: YIELD_AGENTS,
    docsPath: "examples/templates/defi-yield-rebalance/README.md",
    createdAt: "2026-09-28T00:00:00.000Z",
  },
  "builtin:solana-workstation": {
    id: "builtin:solana-workstation",
    name: "Solana agent workstation",
    description: "Orchestrator, analyst, and capped executor with Jupiter quotes and ASH payments.",
    icon: "🛰️",
    summary:
      "Rails governs spend; integrations MCP builds swaps that route through Raydium, Orca, and more.",
    howItWorks: [
      "The orchestrator reads policy headroom and coordinates tasks. The analyst pulls Jupiter quotes and ecosystem context.",
      "The executor pays only allowlisted desks and vendors through execute_payment — never a pool vault.",
      "Swaps sign from the desk wallet after treasury funds it; retries use reference ids tied to each plan.",
    ].join("\n\n"),
    setupSteps: [
      "pnpm ash init for devnet treasury with USDC/SOL limits sized for your desk.",
      "Allowlist swap-desk and any vendor pay_to wallets (dest add).",
      "Apply this template in the dashboard, then create sessions per role (orchestrator readonly, executor full).",
      "pnpm build && use ash-integrations mcp jupiter in the exported runner config.",
      "Run guardian-watch on the workflow treasury before leaving the executor unattended.",
    ],
    agents: WORKSTATION_AGENTS,
    docsPath: "examples/templates/solana-workstation/README.md",
    createdAt: "2026-09-29T00:00:00.000Z",
  },
  "builtin:cloak-private-payout": {
    id: "builtin:cloak-private-payout",
    name: "Private payout desk (Cloak + Zcash)",
    description:
      "Pay people in SOL or ZEC with no direct on-chain link to your wallet. Ask in chat, approve in your wallet.",
    icon: "🕶️",
    summary:
      "You ask in chat and the model only drafts. Your wallet approves, and your browser pays through Cloak on mainnet.",
    howItWorks: [
      'Ask the assistant to pay someone privately, for example "pay 0.02 SOL to <address> and 0.02 SOL in ZEC to <address>". It answers with a payout card; nothing moves until you approve it in your wallet.',
      "Your browser shields the SOL into Cloak's pool, then pays each payee from the pool: SOL straight out, ZEC through a private swap. There is no direct on-chain link between the deposit and the payouts, though amounts and timing can still be matched.",
      "This is not a vault payment: it runs from your own wallet on mainnet, with small caps. The CSV for your accountant is built in your browser from a viewing key derived from your wallet. Cloak's relay receives that viewing key too, and for these notes it is enough to rebuild their keys, so the caps are what bound that trust.",
    ].join("\n\n"),
    setupSteps: [
      "Set NEXT_PUBLIC_CLOAK_MAINNET=1, NEXT_PUBLIC_CLOAK_RPC_URL and NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS, then rebuild.",
      "Use a throwaway wallet with about 0.1 SOL: this runs on mainnet with real funds.",
      "Connect that wallet in the header, with Phantom on mainnet.",
      'Ask in the chat: "pay 0.02 SOL to <address> and 0.02 SOL in ZEC to <address>".',
      "Check every address on the card, approve, and sign each wallet prompt.",
      "Download the proof pack and the CSV when it finishes.",
    ],
    agents: CLOAK_AGENTS,
    docsPath: "examples/templates/cloak-private-payout/README.md",
    createdAt: "2026-10-04T00:00:00.000Z",
  },
};

export function isBuiltinTemplateId(id: string): id is BuiltinTemplateId {
  return Object.hasOwn(BUILTIN_TEMPLATES, id);
}

export function listBuiltinTemplates(): WorkflowTemplate[] {
  return Object.values(BUILTIN_TEMPLATES);
}

export function resolveTemplate(
  templateId: string,
  custom: WorkflowTemplate[],
): WorkflowTemplate | null {
  if (isBuiltinTemplateId(templateId)) return BUILTIN_TEMPLATES[templateId];
  return custom.find((row) => row.id === templateId) ?? null;
}
