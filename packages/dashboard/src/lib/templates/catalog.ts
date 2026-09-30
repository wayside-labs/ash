import type { StoredWorkflowTemplate, TemplateAgentDef } from "@/lib/schema";

type WorkflowTemplate = StoredWorkflowTemplate;

export type BuiltinTemplateId =
  | "builtin:earn-bounty-hunter"
  | "builtin:dca-sol"
  | "builtin:defi-yield-rebalance"
  | "builtin:solana-workstation";

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
      "The builder pays RPC, inference, and hosting through Agent Rails — not a hot wallet.",
      "You submit on Earn; the agents never widen their own limits.",
    ].join("\n\n"),
    setupSteps: [
      "Run pnpm agent-rails init for a devnet treasury and USDC/SOL policy.",
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
    summary:
      "Cron + agent-rails pay moves a fixed amount each period; swaps happen from your desk wallet.",
    howItWorks: [
      "A treasury holds USDC. A cron script calls agent-rails pay on a schedule.",
      "Each payment uses a reference tied to the period so retries cannot double-pay.",
      "The swap desk is an allowlisted owner you control; Agent Rails does not swap on-chain.",
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
    description:
      "Orchestrator, analyst, and capped executor with Jupiter quotes and Agent Rails payments.",
    icon: "🛰️",
    summary:
      "Rails governs spend; integrations MCP builds swaps that route through Raydium, Orca, and more.",
    howItWorks: [
      "The orchestrator reads policy headroom and coordinates tasks. The analyst pulls Jupiter quotes and ecosystem context.",
      "The executor pays only allowlisted desks and vendors through execute_payment — never a pool vault.",
      "Swaps sign from the desk wallet after treasury funds it; retries use reference ids tied to each plan.",
    ].join("\n\n"),
    setupSteps: [
      "pnpm agent-rails init for devnet treasury with USDC/SOL limits sized for your desk.",
      "Allowlist swap-desk and any vendor pay_to wallets (dest add).",
      "Apply this template in the dashboard, then create sessions per role (orchestrator readonly, executor full).",
      "pnpm build && use agent-rails-integrations mcp jupiter in the exported runner config.",
      "Run guardian-watch on the workflow treasury before leaving the executor unattended.",
    ],
    agents: WORKSTATION_AGENTS,
    docsPath: "examples/templates/solana-workstation/README.md",
    createdAt: "2026-09-29T00:00:00.000Z",
  },
};

export function isBuiltinTemplateId(id: string): id is BuiltinTemplateId {
  return id in BUILTIN_TEMPLATES;
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
