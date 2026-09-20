import type { DashboardState } from "@/lib/schema";

const NOW = "2026-09-20T00:00:00.000Z";

/**
 * First-run content so the dashboard has something to show before anything is
 * bootstrapped on-chain. Every row is flagged `demo: true`: the UI labels them
 * and Settings → Dados can clear them. Demo rows carry no wallet address on
 * purpose — a placeholder string would otherwise reach the RPC as a real query.
 */
export function seedState(): DashboardState {
  return {
    version: 1,
    workflows: [
      {
        id: "w_demo_loja",
        name: "Minha Loja Online",
        description: "E-commerce com agentes de vendas e suporte",
        icon: "🏪",
        treasuryAddress: null,
        ownerAddress: null,
        cluster: "devnet",
        demo: true,
        demoBalanceUsd: 2450,
        createdAt: NOW,
      },
      {
        id: "w_demo_defi",
        name: "DeFi Trading",
        description: "Agentes de trading e análise de mercado",
        icon: "📈",
        treasuryAddress: null,
        ownerAddress: null,
        cluster: "devnet",
        demo: true,
        demoBalanceUsd: 550,
        createdAt: NOW,
      },
      {
        id: "w_demo_fornec",
        name: "Pagamentos Fornecedores",
        description: "Automação de contas a pagar",
        icon: "🏭",
        treasuryAddress: null,
        ownerAddress: null,
        cluster: "devnet",
        demo: true,
        demoBalanceUsd: 2800,
        createdAt: NOW,
      },
    ],
    agents: [
      agent("a_demo_maria", "Maria", "Gerente Financeira", "w_demo_loja", 50, 200, 12, [
        "OpenAI",
        "Fornecedores",
      ]),
      agent("a_demo_joao", "João", "Assistente de Vendas", "w_demo_loja", 100, 150, 45, [
        "Clientes",
        "Marketing",
      ]),
      agent("a_demo_ana", "Ana", "Suporte", "w_demo_loja", 0, 0, 0, []),
      {
        ...agent("a_demo_carlos", "Carlos", "Logística", "w_demo_loja", 30, 75, 8, [
          "Transportadoras",
        ]),
        status: "paused",
      },
      agent("a_demo_trader", "Trader Bot", "Trader DeFi", "w_demo_defi", 100, 500, 67, [
        "Jupiter",
        "Raydium",
      ]),
      agent("a_demo_research", "Researcher", "Analista de Mercado", "w_demo_defi", 20, 50, 5, [
        "APIs de dados",
      ]),
      agent("a_demo_cfo", "CFO Bot", "Pagamentos", "w_demo_fornec", 500, 2000, 320, [
        "Fornecedor A",
        "Fornecedor B",
      ]),
      agent("a_demo_ap", "AP Assistant", "Contas a Pagar", "w_demo_fornec", 200, 800, 89, [
        "Fornecedores",
      ]),
    ],
    mcps: [
      {
        id: "m_agent_rails",
        name: "Agent Rails Payments",
        description: "Pagamentos com limites e auditoria on-chain",
        enabled: true,
        scope: "global",
        scopeName: null,
        demo: false,
      },
      {
        id: "m_jupiter",
        name: "Jupiter Swap",
        description: "Trocar tokens dentro do limite do agente",
        enabled: false,
        scope: "workflow",
        scopeName: "DeFi Trading",
        demo: true,
      },
      {
        id: "m_superteam",
        name: "Superteam Earn",
        description: "Buscar bounties e grants para agentes",
        enabled: false,
        scope: "global",
        scopeName: null,
        demo: true,
      },
      {
        id: "m_helius",
        name: "Helius RPC",
        description: "Dados on-chain e webhooks",
        enabled: false,
        scope: "global",
        scopeName: null,
        demo: true,
      },
    ],
    rag: [
      doc("r_demo_catalogo", "Catálogo de produtos.pdf", "pdf", "indexed", "Minha Loja Online"),
      doc("r_demo_devolucao", "Política de devolução.md", "md", "indexed", "Minha Loja Online"),
      doc("r_demo_faq", "FAQ atendimento.md", "md", "indexed", "Ana — Suporte"),
      doc("r_demo_defi", "Manual DeFi protocols", "url", "indexed", "DeFi Trading"),
    ],
    skills: [
      skill(
        "s_pagar",
        "Fazer pagamento",
        "Executar pagamento dentro dos limites",
        "💰",
        "global",
        null,
        true,
        false,
      ),
      skill(
        "s_saldo",
        "Consultar saldo",
        "Verificar saldo do cofre ou agente",
        "📊",
        "global",
        null,
        true,
        false,
      ),
      skill(
        "s_pool",
        "Analisar pool de liquidez",
        "Avaliar pools DeFi antes de operar",
        "📈",
        "workflow",
        "DeFi Trading",
        false,
        true,
      ),
      skill(
        "s_stop",
        "Stop-loss automático",
        "Vender automaticamente em perda",
        "⚡",
        "agent",
        "Trader Bot",
        false,
        true,
      ),
    ],
    apiKeys: [],
    integrations: [
      integration("jupiter", "Jupiter", "Swaps e roteamento de tokens", "🪐", "https://jup.ag"),
      integration("raydium", "Raydium", "Pools de liquidez e farming", "💧", "https://raydium.io"),
      integration(
        "marinade",
        "Marinade",
        "Staking líquido de SOL",
        "🥩",
        "https://marinade.finance",
      ),
      integration(
        "superteam",
        "Superteam Earn",
        "Bounties e grants para agentes",
        "💰",
        "https://earn.superteam.fun",
      ),
      integration("squads", "Squads", "Multisig como owner do treasury", "🛡️", "https://squads.so"),
    ],
    profile: { displayName: "", company: "", bio: "", email: "" },
    settings: { language: "pt-BR", emailNotifications: false, limitAlerts: true },
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
    receivesFrom: "Cofre do workflow",
    status: "active",
    demo: true,
    demoBalanceUsd,
    demoSpentUsd,
    createdAt: NOW,
  };
}

function doc(
  id: string,
  name: string,
  type: "pdf" | "md" | "url",
  status: "indexed" | "indexing" | "error",
  scopeName: string,
): DashboardState["rag"][number] {
  return { id, name, type, status, scope: "workflow", scopeName, source: null, demo: true };
}

function skill(
  id: string,
  name: string,
  description: string,
  icon: string,
  scope: "global" | "workflow" | "agent",
  scopeName: string | null,
  enabled: boolean,
  demo: boolean,
): DashboardState["skills"][number] {
  return { id, name, description, icon, scope, scopeName, enabled, demo };
}

function integration(
  id: string,
  name: string,
  description: string,
  icon: string,
  url: string,
): DashboardState["integrations"][number] {
  return { id, name, description, icon, url, connected: false };
}
