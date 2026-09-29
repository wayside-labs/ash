import type { DashboardState } from "@/lib/schema";
import { BUILTIN_SKILLS } from "./builtin-skills";

const NOW = "2026-09-20T00:00:00.000Z";

/**
 * First-run content so the dashboard has something to show before anything is
 * bootstrapped on-chain. Every row is flagged `demo: true`: the UI labels them
 * and Settings → Data can clear them. Demo rows carry no wallet address on
 * purpose — a placeholder string would otherwise reach the RPC as a real query.
 */
export function seedState(): DashboardState {
  return {
    version: 1,
    workflows: [
      {
        id: "w_demo_loja",
        name: "My Online Store",
        description: "E-commerce with sales and support agents",
        icon: "🏪",
        treasuryAddress: null,
        ownerAddress: null,
        cluster: "devnet",
        demo: true,
        demoBalanceUsd: 2450,
        layout: { positions: {}, hidden: [] },
        createdAt: NOW,
      },
      {
        id: "w_demo_defi",
        name: "DeFi Trading",
        description: "Trading and market analysis agents",
        icon: "📈",
        treasuryAddress: null,
        ownerAddress: null,
        cluster: "devnet",
        demo: true,
        demoBalanceUsd: 550,
        layout: { positions: {}, hidden: [] },
        createdAt: NOW,
      },
      {
        id: "w_demo_fornec",
        name: "Vendor Payments",
        description: "Accounts payable automation",
        icon: "🏭",
        treasuryAddress: null,
        ownerAddress: null,
        cluster: "devnet",
        demo: true,
        demoBalanceUsd: 2800,
        layout: { positions: {}, hidden: [] },
        createdAt: NOW,
      },
    ],
    agents: [
      agent("a_demo_maria", "Maria", "Finance Manager", "w_demo_loja", 50, 200, 12, [
        "OpenAI",
        "Vendors",
      ]),
      agent("a_demo_joao", "João", "Sales Assistant", "w_demo_loja", 100, 150, 45, [
        "Customers",
        "Marketing",
      ]),
      agent("a_demo_ana", "Ana", "Support", "w_demo_loja", 0, 0, 0, []),
      {
        ...agent("a_demo_carlos", "Carlos", "Logistics", "w_demo_loja", 30, 75, 8, ["Carriers"]),
        status: "paused",
      },
      agent("a_demo_trader", "Trader Bot", "DeFi Trader", "w_demo_defi", 100, 500, 67, [
        "Jupiter",
        "Raydium",
      ]),
      agent("a_demo_research", "Researcher", "Market Analyst", "w_demo_defi", 20, 50, 5, [
        "Data APIs",
      ]),
      agent("a_demo_cfo", "CFO Bot", "Payments", "w_demo_fornec", 500, 2000, 320, [
        "Vendor A",
        "Vendor B",
      ]),
      agent("a_demo_ap", "AP Assistant", "Accounts Payable", "w_demo_fornec", 200, 800, 89, [
        "Vendors",
      ]),
    ],
    mcps: [
      {
        id: "m_agent_rails",
        name: "Agent Rails Payments",
        description: "Payments with limits and on-chain audit",
        enabled: true,
        scope: "global",
        scopeName: null,
        // The real server from packages/mcp. The env keys are seeded empty on
        // purpose: they name what the user has to fill in, and an empty value
        // is dropped from the export rather than shipped as a set-but-blank
        // variable the server would then reject for the wrong reason.
        command: "agent-rails-mcp",
        args: [],
        env: {
          AGENT_RAILS_RPC: "",
          AGENT_RAILS_SESSION: "",
          AGENT_RAILS_SIGNER: "",
        },
        demo: false,
      },
      {
        id: "m_knowledge",
        name: "Knowledge base",
        description: "Read-only search over the documents on the Knowledge page",
        enabled: false,
        scope: "global",
        scopeName: null,
        // Path relative to a checkout, like the MCP snippet. The export fills in the
        // dashboard URL, the workflow token and, per agent, the agent's name.
        command: "node",
        args: ["packages/knowledge-mcp/dist/cli.js"],
        env: {},
        demo: false,
      },
      ...(["oracle", "notary", "compute"] as const).map((vendor, i) => ({
        id: `m_vendor_${vendor}`,
        name: `Vendor: ${vendor}`,
        description: [
          "Pay-per-quote prices (packages/vendors)",
          "Document hash timestamps (packages/vendors)",
          "Prepaid credits for text jobs (packages/vendors)",
        ][i] as string,
        enabled: false,
        scope: "global" as const,
        scopeName: null,
        // Holds no key: buying still goes through the Agent Rails payment MCP.
        command: "node",
        args: ["packages/vendors/dist/cli.js", "mcp", vendor],
        env: {
          [`${vendor.toUpperCase()}_URL`]: `http://127.0.0.1:${4101 + i}`,
          AGENT_RAILS_SESSION: "",
        },
        demo: false,
      })),
      {
        id: "m_jupiter",
        name: "Jupiter Swap",
        description: "Swap tokens within the agent's limit",
        enabled: false,
        scope: "workflow",
        scopeName: "DeFi Trading",
        command: "",
        args: [],
        env: {},
        demo: true,
      },
      {
        id: "m_superteam",
        name: "Superteam Earn",
        description: "Find bounties and grants for agents",
        enabled: false,
        scope: "global",
        scopeName: null,
        command: "",
        args: [],
        env: {},
        demo: true,
      },
      {
        id: "m_helius",
        name: "Helius RPC",
        description: "On-chain data and webhooks",
        enabled: false,
        scope: "global",
        scopeName: null,
        command: "",
        args: [],
        env: {},
        demo: true,
      },
    ],
    // RAG and Integrations have no backend: their pages were pruned, so seeding
    // rows here would write state nothing renders. The collections stay in the
    // schema so an existing dashboard.json still parses.
    rag: [],
    skills: [
      ...BUILTIN_SKILLS,
      {
        id: "s_pool",
        name: "Analyze liquidity pool",
        description: "Evaluate DeFi pools before operating",
        icon: "\u{1F4C8}",
        scope: "workflow",
        scopeName: "DeFi Trading",
        enabled: false,
        demo: true,
        content: [
          "## When to use",
          "",
          "Before entering any pool position.",
          "",
          "## Checklist",
          "",
          "- TVL and 24h volume; a pool with volume far above TVL is thin.",
          "- Fee tier against realised volatility of the pair.",
          "- Token mint authority and freeze authority: both should be renounced.",
          "- Impermanent-loss exposure at \u00b120% price movement.",
          "",
          "Report the checklist result before proposing a position, and say",
          "plainly when the data is missing rather than scoring it anyway.",
        ].join("\n"),
      },
      {
        id: "s_stop",
        name: "Automatic stop-loss",
        description: "Sell automatically on loss",
        icon: "\u26A1",
        scope: "agent",
        scopeName: "Trader Bot",
        enabled: false,
        demo: true,
        content: [
          "## When to use",
          "",
          "A held position moves against the entry price by more than the",
          "configured threshold.",
          "",
          "## How",
          "",
          "1. Compare the mark price to the recorded entry.",
          "2. Below the threshold, exit the whole position in one order.",
          "3. Record the exit and the realised result.",
          "",
          "## Rules",
          "",
          "- Never average down to avoid triggering the stop.",
          "- The exit is still a payment: it passes the same policy checks, and",
          "  a refusal means the position stays open. Escalate, do not retry.",
        ].join("\n"),
      },
    ],
    templates: [],
    apiKeys: [],
    integrations: [],
    profile: { displayName: "", company: "", bio: "", email: "" },
    settings: { language: "en", emailNotifications: false, limitAlerts: true, alertWebhookUrl: "" },
  };
}

function agent(
  id: string,
  name: string,
  role: string,
  workflowId: string,
  dailyLimitUsd: number,
  demoBalanceUsd: number,
  demoSpentUsd: number,
  paysTo: string[],
): DashboardState["agents"][number] {
  return {
    id,
    name,
    role,
    workflowId,
    walletAddress: null,
    sessionAddress: null,
    dailyLimitUsd,
    paysTo,
    receivesFrom: "Workflow vault",
    status: "active",
    demo: true,
    demoBalanceUsd,
    demoSpentUsd,
    createdAt: NOW,
  };
}
