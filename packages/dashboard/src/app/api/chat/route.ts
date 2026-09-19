import type { NextRequest } from "next/server";

const SYSTEM_PROMPT = `Você é o assistente do Agent Rails — uma plataforma que permite criar e gerenciar agentes de IA que fazem pagamentos na Solana com limites e segurança.

Quando o usuário pedir para criar algo (ex: "sistema de agentes DeFi", "pagamentos de fornecedores"), responda em português brasileiro explicando:
1. O que você vai criar (workflow, agentes, cofre/treasury)
2. Como cada parte funciona em linguagem simples
3. Próximos passos práticos

Conceitos traduzidos:
- Workflow = empresa/projeto/operação
- Treasury/Cofre = fundo principal com dinheiro
- Agent = funcionário digital com limites de gasto
- Policy/Limites = quanto cada agente pode gastar
- MCP = ferramentas que o agente usa (pagamentos, swaps, etc.)

Seja conciso, amigável e prático. Use markdown leve quando útil.`;

function demoReply(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes("defi") || lower.includes("trading")) {
    return `Perfeito! Vou criar um **Workflow DeFi Trading** com:

1. **Cofre (Treasury)** — onde você deposita USDC/SOL
2. **Agent "Trader Bot"** — executa swaps no Jupiter (limite: $100/dia)
3. **Agent "Researcher"** — analisa mercado antes de operar
4. **MCP Jupiter** — conectado para trocas de tokens
5. **Limites** — teto de $500/semana no workflow

**Próximo passo:** Conecte sua wallet e clique em "Criar tudo" na aba Workflows, ou me diga quanto quer depositar inicialmente.`;
  }

  if (lower.includes("fornecedor") || lower.includes("pagamento")) {
    return `Vou montar um **Workflow de Pagamentos a Fornecedores**:

1. **Cofre** — fundo central da empresa
2. **Agent CFO** — aprova e executa pagamentos (limite: $500/dia)
3. **Agent AP** — processa faturas e agenda pagamentos
4. **Lista de destinos** — só paga para fornecedores cadastrados
5. **Auditoria** — cada pagamento registrado on-chain

**Segurança:** Mesmo se o agente for comprometido, ele não pode gastar mais que o limite diário.

Conecte sua wallet para começar!`;
  }

  if (lower.includes("loja") || lower.includes("e-commerce") || lower.includes("vendas")) {
    return `Vou criar um **Workflow de Loja Online**:

1. **Agent Vendas** — processa pedidos e pagamentos
2. **Agent Suporte** — atende clientes (sem permissão de pagar)
3. **Agent Logística** — paga transportadoras (limite: $30/dia)
4. **RAG** — catálogo de produtos como base de conhecimento

Cada agente tem seu próprio saldo e limites. Quer que eu configure agora?`;
  }

  return `Entendi! Para criar seu sistema de agentes, preciso saber um pouco mais:

- **Tipo de operação:** DeFi, e-commerce, pagamentos, trading, outro?
- **Quantos agentes** você imagina?
- **Orçamento inicial** para o cofre?

Exemplos do que posso criar:
- "Quero agentes DeFi para trading"
- "Preciso pagar fornecedores automaticamente"
- "Quero uma loja online com agentes de vendas"

Me conte mais e eu configuro tudo!`;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as { message: string; model: string };
  const { message } = body;

  if (!message?.trim()) {
    return Response.json({ error: "Message required" }, { status: 400 });
  }

  // Demo mode — configure OPENAI_API_KEY in .env for live LLM responses
  void SYSTEM_PROMPT;
  return Response.json({ reply: demoReply(message) });
}
