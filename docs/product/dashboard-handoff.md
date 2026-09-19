# Agent Rails Dashboard — Handoff de implementação

**Data:** 2026-09-19  
**Status:** scaffold UI completo · dados mock · integração on-chain pendente  
**Pacote:** `packages/dashboard` (`@agent-rails/dashboard`)  
**Objetivo deste doc:** servir como referência para tornar o dashboard funcional (substituir mocks, conectar SDK/CLI, auth, chat real).

---

## 1. Visão do produto

Dashboard web **chat-first** para usuários que não conhecem Solana nem agentes. O usuário chega, diz *"quero construir um sistema de agentes DeFi"* e o sistema cria workflow + treasury + agentes + limites, explicando cada parte.

### Público

- Enterprise (pagamentos a fornecedores)
- Dev solo (trading, loja online)
- Qualquer operação agentica com pagamentos Solana

### Princípios UX

1. Linguagem humana — "Cofre" em vez de "Treasury PDA"
2. Chat como porta de entrada principal
3. Sidebar organizacional (workflows → agents → money → tools → settings)
4. Toggle visível: **Solana Nativo** vs **Agent Rails Vault**
5. Seletor de rede sempre visível: Devnet / Testnet / Mainnet
6. Complexidade revelada progressivamente (modo avançado para Harness, RPC, etc.)

### Referências visuais

- Layout: sidebar esquerda + chat central (desenhos do tablet do usuário)
- Workflows: rows horizontais estilo Netflix com scroll de agent cards
- My APIs: cards com KEY + toggle show/hide (olho)
- Paleta: dark mode, accent verde Solana `#14F195`, badges de rede coloridos

---

## 2. Stack escolhida

| Camada | Tecnologia | Notas |
|---|---|---|
| Framework | Next.js 15 App Router | API routes para chat, keys, bootstrap |
| UI | React 19 + TypeScript strict | |
| Estilo | Tailwind CSS v4 | `@theme` em `globals.css` |
| Componentes | Radix UI (estilo shadcn) | Código em `src/components/ui/` |
| Estado global | Zustand + persist | `src/stores/app-store.ts` |
| Server state | TanStack Query | Provider em `providers.tsx`, ainda não usado |
| Wallet | Phantom via `window.phantom.solana` | **Não** usa `@solana/kit-plugin-wallet` ainda |
| On-chain | `@agent-rails/sdk` + `@agent-rails/contract` | Declarado como dep, **não wired** |
| Chat | API route demo | Respostas hardcoded; sem LLM real |

### Decisões explícitas

- **React, não Flutter** — reuso do monorepo TS, SDK, MCP, hackathon speed
- **Modo padrão hackathon:** Solana Nativo (menos fricção); Agent Rails Vault como toggle
- **Google OAuth:** conta off-chain; wallet obrigatória para on-chain; embedded wallet opcional (Privy) — não implementado
- **Superteam Earn:** integração futura via MCP ou aba Integrations

---

## 3. Como rodar

```bash
cd /home/dev0xcf02/projects/solana/agent-rails

# Se rede lenta (recomendado no Brasil):
pnpm config set registry https://registry.npmmirror.com
pnpm config set fetch-timeout 600000
pnpm config set network-concurrency 1

pnpm install
pnpm build --filter @agent-rails/sdk
pnpm dashboard          # alias: pnpm --filter @agent-rails/dashboard dev
```

Abrir: http://localhost:3000

Build produção:

```bash
pnpm dashboard:build
pnpm --filter @agent-rails/dashboard start
```

Env: copiar `packages/dashboard/.env.example` → `packages/dashboard/.env.local`

---

## 4. Estrutura de arquivos

```
packages/dashboard/
├── package.json
├── tsconfig.json
├── next.config.ts              # transpilePackages: sdk, client, contract
├── postcss.config.mjs
├── .env.example
├── .gitignore
├── README.md
└── src/
    ├── app/
    │   ├── layout.tsx          # Root layout, Inter font, dark mode
    │   ├── globals.css         # Tailwind v4 @theme tokens
    │   ├── providers.tsx       # QueryClient + TooltipProvider
    │   ├── api/
    │   │   └── chat/route.ts   # POST — demo replies (sem LLM)
    │   └── (dashboard)/        # Route group com shell
    │       ├── layout.tsx      # DashboardShell (sidebar + header)
    │       ├── page.tsx        # Home: chat + workflow rows
    │       ├── workflows/page.tsx
    │       ├── agents/page.tsx
    │       ├── wallets/page.tsx
    │       ├── mcps/page.tsx
    │       ├── rag/page.tsx
    │       ├── skills/page.tsx
    │       ├── apis/page.tsx
    │       ├── treasury/page.tsx
    │       ├── limits/page.tsx
    │       ├── integrations/page.tsx
    │       ├── harness/page.tsx
    │       ├── account/page.tsx
    │       ├── profile/page.tsx
    │       └── settings/page.tsx
    ├── components/
    │   ├── layout/
    │   │   ├── dashboard-shell.tsx
    │   │   ├── header.tsx      # rede, modo, connect wallet
    │   │   ├── sidebar.tsx
    │   │   └── nav-items.ts    # 15 itens de menu
    │   ├── chat/
    │   │   └── chat-panel.tsx
    │   ├── workflows/
    │   │   ├── agent-card.tsx
    │   │   └── workflow-row.tsx  # scroll horizontal Netflix
    │   ├── wallet/
    │   │   └── connect-button.tsx  # Phantom only
    │   ├── shared/
    │   │   ├── page-header.tsx
    │   │   └── empty-state.tsx
    │   └── ui/                   # button, card, input, select, tabs, etc.
    ├── lib/
    │   ├── types.ts              # Agent, Workflow, WalletInfo, etc.
    │   ├── mock-data.ts          # 3 workflows, 8 agents, wallets, MCPs...
    │   ├── solana.ts             # RPC URLs, Phantom helper
    │   └── utils.ts              # cn, truncateAddress, formatUsd
    └── stores/
        └── app-store.ts          # cluster, mode, wallet, model, sidebar
```

### Scripts adicionados na raiz (`package.json`)

```json
"dashboard": "pnpm --filter @agent-rails/dashboard dev",
"dashboard:build": "pnpm --filter @agent-rails/dashboard build"
```

---

## 5. Páginas e estado atual

| Rota | Arquivo | UI | Dados | Ações |
|---|---|---|---|---|
| `/` | `page.tsx` | ✅ Chat + workflows | mock | Enviar chat (demo) |
| `/workflows` | `workflows/page.tsx` | ✅ Netflix rows | mock | Botões sem handler |
| `/agents` | `agents/page.tsx` | ✅ Grid por workflow | mock | — |
| `/wallets` | `wallets/page.tsx` | ✅ Cards agrupados | mock | Copy sem clipboard |
| `/treasury` | `treasury/page.tsx` | ✅ Cards cofre | mock | Depositar/Sacar fake |
| `/limits` | `limits/page.tsx` | ✅ Progress bars | mock | — |
| `/mcps` | `mcps/page.tsx` | ✅ Lista + switch | mock | Switch não persiste |
| `/rag` | `rag/page.tsx` | ✅ Lista docs | mock | Upload fake |
| `/skills` | `skills/page.tsx` | ✅ Tabs global/wf/agent | mock | Switch não persiste |
| `/apis` | `apis/page.tsx` | ✅ Cards KEY + olho | mock | Não salva keys |
| `/integrations` | `integrations/page.tsx` | ✅ dApps + modo toggle | mock + zustand | Toggle modo funciona |
| `/harness` | `harness/page.tsx` | ✅ Runtime cards | mock derivado | Start/Stop fake |
| `/account` | `account/page.tsx` | ✅ Login Google demo | zustand | Google = email hardcoded |
| `/profile` | `profile/page.tsx` | ✅ Form perfil | zustand wallet | Salvar fake |
| `/settings` | `settings/page.tsx` | ✅ RPC, idioma, prefs | zustand | Testar RPC fake |

### Header global (sempre visível)

Arquivo: `src/components/layout/header.tsx`

- Seletor cluster: devnet / testnet / mainnet-beta → `useAppStore.setCluster`
- Seletor modo: Solana Nativo / Agent Rails Vault → `useAppStore.setOperationMode`
- Connect Wallet → Phantom via `connect-button.tsx`
- Badge de rede colorido (warning/secondary/destructive)

### Sidebar

Arquivo: `src/components/layout/nav-items.ts` — 15 itens  
Arquivo: `src/components/layout/sidebar.tsx` — collapse mobile, footer com modo atual

---

## 6. O que é REAL vs MOCK

### Funciona de verdade (persiste ou interage)

| Feature | Onde |
|---|---|
| Navegação entre páginas | Next.js App Router |
| Dark mode | `html.dark` + CSS tokens |
| Cluster / modo / modelo selecionado | `app-store.ts` → localStorage |
| RPC customizado (valor no input) | zustand persist |
| Toggle modo Solana/Agent Rails | zustand + Integrations page |
| Connect Phantom | `getPhantomProvider()` → setWallet |
| Chat POST | `/api/chat` → respostas demo contextual |
| Layout responsivo | sidebar collapse mobile |

### Mock / placeholder

| Feature | Arquivo mock | O que falta |
|---|---|---|
| Workflows, agents, wallets | `lib/mock-data.ts` | Backend / indexer / on-chain reads |
| Saldos, limites, status | mock | Treasury PDA, Policy, Session PDAs |
| MCPs, RAG, Skills | mock | CRUD + MCP server config |
| API keys | mock | Server-side encrypted storage |
| Google OAuth | demo click | NextAuth ou Privy |
| Depositar/Sacar | botões vazios | SDK withdraw + SPL transfer |
| Criar workflow/agente | botões vazios | CLI `init` ou API bootstrap |
| Chat inteligente | `demoReply()` | Vercel AI SDK + tool calling |
| Harness logs | fake | Docker/API runtime |
| Superteam Earn | listed disabled | API earn.superteam.fun |
| `@agent-rails/sdk` | imported in package.json only | Plugin client + RPC reads |

---

## 7. Modelo de dados (types)

Arquivo: `src/lib/types.ts`

```
SolanaCluster     = devnet | testnet | mainnet-beta
OperationMode     = native | agent-rails

Workflow          → id, name, description, icon, treasuryBalanceUsd, agents[]
Agent             → id, name, role, workflowId, walletAddress, balanceUsd,
                    dailyLimitUsd, dailySpentUsd, paysTo[], receivesFrom, status
WalletInfo        → id, name, address, type (treasury|agent|owner), balanceUsd,
                    workflowId, workflowName, agentId?, dailyLimit*
McpServer         → id, name, description, enabled, scope (global|workflow|agent)
RagDocument       → id, name, type, status, scope
Skill             → id, name, description, icon, scope, enabled
ApiKeyEntry       → id, provider, keyMasked, status
```

### Mapeamento UI → Agent Rails on-chain

| UI | On-chain / off-chain |
|---|---|
| Workflow | Organização off-chain → 1+ Treasury |
| Agent | AgentSession PDA + runtime (MCP, modelo) |
| Treasury / Cofre | Treasury PDA + vault ATAs + PolicyCeiling |
| Limits | Policy (operator) ≤ PolicyCeiling (owner) |
| Wallets agent | Session key (hot) |
| Wallets treasury | Vault ATA / sol_vault |
| Wallets owner | Owner pubkey (Phantom) |
| MCPs | `@agent-rails/mcp` + outros servidores |
| Harness | Onde o agente roda (local/VPS/Docker) |

---

## 8. Chat — estado e roadmap

### Atual

- `src/components/chat/chat-panel.tsx` — UI completa, seletor de modelo, streaming placeholder
- `src/app/api/chat/route.ts` — `demoReply()` com respostas para DeFi, fornecedores, e-commerce
- Sem `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` wired

### Roadmap funcional

1. Integrar Vercel AI SDK (`ai` + `@ai-sdk/openai` ou `@ai-sdk/anthropic`)
2. Tools do chat (server-side only, sem escalada de privilégio):
   - `create_workflow` → chama bootstrap
   - `explain_concept` → educação
   - `list_treasuries` → read-only RPC
3. **Nunca** expor ao agente: withdraw, update_policy, unpause, create_session com limites altos
4. Respostas em PT-BR por default

---

## 9. Wallet e auth — estado e roadmap

### Wallet (atual)

- `src/lib/solana.ts` — RPC URLs, `getPhantomProvider()`
- `src/components/wallet/connect-button.tsx` — Phantom connect/disconnect
- **Não usa** `@solana/kit-plugin-wallet` (recomendado pelo skill solana-dev para produção)

### Auth (atual)

- Account page: botão "Entrar com Google" seta `googleEmail = "usuario@gmail.com"` no zustand
- Sem NextAuth, sem Privy, sem sessão server-side

### Roadmap recomendado

| Fluxo | Implementação |
|---|---|
| Google login | Privy ou NextAuth — conta off-chain |
| Connect wallet | `@solana/kit-plugin-wallet` + `@solana/react` |
| Embedded wallet | Privy — só com aviso + recovery phrase |
| On-chain actions | Exigir wallet conectada; simular antes de assinar |

---

## 10. Integração Agent Rails — como conectar

### CLI existente

```bash
pnpm agent-rails init --rpc <url> --yes
```

Cria treasury, policy, allowlist, session, imprime MCP config.  
Código: `packages/cli/src/commands/init.ts`, `packages/cli/src/bootstrap.ts`

### SDK

```typescript
import { agentRails, findTreasuryPda, /* ... */ } from "@agent-rails/sdk";
```

Plugin: `client.use(agentRails({ session, signer, security }))`

### Plano de integração por camada

```
┌─────────────────────────────────────────────────────────┐
│  Dashboard UI (React)                                   │
├─────────────────────────────────────────────────────────┤
│  API Routes (Next.js)                                   │
│  - POST /api/chat                                       │
│  - POST /api/bootstrap     ← wrap agent-rails init      │
│  - GET  /api/treasury/:id  ← RPC read                   │
│  - POST /api/treasury/deposit|withdraw                  │
│  - CRUD /api/workflows (SQLite/Postgres ou .agent-rails)│
├─────────────────────────────────────────────────────────┤
│  @agent-rails/sdk + @solana/kit                         │
├─────────────────────────────────────────────────────────┤
│  Solana (devnet/testnet/mainnet)                        │
└─────────────────────────────────────────────────────────┘
```

### Leituras on-chain necessárias (prioridade)

1. Treasury account → saldo vault, owner, paused
2. Policy → limites per-tx, window, lifetime
3. AgentSession → counters, expires_at, status
4. AllowlistEntry → destinos permitidos

### Escritas on-chain (owner/operator only — NÃO no chat agent tools)

- `create_treasury`, `create_policy`, `create_session`
- `withdraw`, `pause`, `set_ceiling`
- Agent MCP surface: apenas `execute_payment`, `check_payment`, `get_payment_status`

---

## 11. Roadmap de implementação (ordem sugerida)

### Fase 1 — Hackathon MVP vertical (prioridade máxima)

- [ ] **1.1** Kit client setup: `src/lib/agent-rails.ts` — createClient + RPC por cluster
- [ ] **1.2** Wallet: migrar para `@solana/kit-plugin-wallet` ou manter Phantom com signer adapter
- [ ] **1.3** Bootstrap API: `POST /api/bootstrap` — executa fluxo equivalente ao `agent-rails init`
- [ ] **1.4** Persistência local: salvar workflows/treasuries em SQLite ou `~/.agent-rails/dashboard.json`
- [ ] **1.5** Substituir mock-data por dados reais pós-bootstrap
- [ ] **1.6** Treasury page: ler saldo real via RPC; botões deposit/withdraw wired
- [ ] **1.7** Chat: conectar LLM + tool `create_workflow` que chama bootstrap

### Fase 2 — Diferencial demo

- [ ] **2.1** Limits page: ler Policy + Session counters on-chain
- [ ] **2.2** Wallets page: derivar endereços de PDAs reais
- [ ] **2.3** My APIs: salvar keys criptografadas server-side (env ou vault)
- [ ] **2.4** MCPs page: gerar snippet MCP config pós-init (como CLI já faz)
- [ ] **2.5** Agents page: pause = link para revoke_session (operator)

### Fase 3 — Pós-hackathon

- [ ] **3.1** Google OAuth real (Privy/NextAuth)
- [ ] **3.2** RAG: upload + index (pgvector, etc.)
- [ ] **3.3** Skills: filesystem skills + marketplace
- [ ] **3.4** Harness: Docker API para start/stop agent runtime
- [ ] **3.5** Superteam Earn: MCP ou integration tab — `GET /api/agents/listings/live`
- [ ] **3.6** Indexer `@agent-rails/indexer` para histórico de pagamentos
- [ ] **3.7** turbo.json: adicionar task `dev` para dashboard

---

## 12. Spec UX por página (referência do usuário)

### Workflows

- Rows horizontais estilo Netflix por empresa/projeto
- Cards de agentes dentro; scroll infinito/loop se > 3–4 agentes
- Cada workflow = 1 treasury

### Agents

- Cards: cargo, saldo, função, de quem recebe, para quem paga, workflow
- Agrupados por workflow

### Wallets

- Retângulos: nome, endereço, workflow, agente, limites
- Tipos: Cofre (treasury), Agente (session), Sua wallet (owner)

### MCPs

- Loja de apps: global / por workflow / por agente
- Toggle on/off + limite por MCP

### RAG

- "Base de conhecimento" — upload PDF/MD/URL
- Herança workflow → agente

### Skills

- Globais / por workflow / por agente
- Inspirado em Cursor Skills

### My APIs

- Cards Anthropic, OpenAI, etc.
- KEY com toggle olho show/hide
- Keys nunca no browser plain text

### Treasury + Limits

- Considerar aba "Money" unificada no futuro
- Limits: árvore ou sliders — verde dentro do teto, vermelho acima

### Integrations

- Toggle Solana Nativo vs Agent Rails Vault **bem visível**
- Jupiter, Raydium, Marinade, Superteam Earn, Squads
- Default hackathon: Solana Nativo

### Harness

- Modo avançado: runtime Docker/VPS/cloud, logs, restart
- Por workflow/agente

### Settings

- RPC custom (Helius), idioma, tema, notificações, export config

---

## 13. Invariantes Agent Rails (NÃO violar na UI)

Do `ARCHITECTURE.md` e ADRs — qualquer implementação funcional deve respeitar:

1. **Loosening flows downhill only** — owner > operator > agent
2. **Agent-facing surface zero privilege escalation** — chat tools NÃO podem: withdraw, update_policy, unpause, allowlist edits
3. **Pause ≠ owner lock** — withdraw owner funciona mesmo paused
4. **Idempotency** — todo pagamento via IntentReceipt
5. **Simulate before send** — mostrar resumo da tx antes de assinar

---

## 14. Dependências e monorepo

### Workspace

`pnpm-workspace.yaml`: `packages/*` — dashboard já incluído

### Dependências workspace

```json
"@agent-rails/contract": "workspace:*",
"@agent-rails/sdk": "workspace:*"
```

Build order: `contract` → `client` → `sdk` → `dashboard`

### turbo.json

Dashboard **não** está no turbo pipeline ainda. Adicionar:

```json
"dev": { "cache": false, "persistent": true }
```

### Biome

Dashboard incluído no lint global (`pnpm lint`). Formato: double quotes, semicolons, 2-space.

---

## 15. Problemas conhecidos / débito técnico

| Issue | Detalhe | Fix |
|---|---|---|
| Dados 100% mock | `mock-data.ts` importado direto nas pages | API layer + RPC reads |
| Phantom only | Sem Solflare, Backpack, Wallet Standard | `@solana/kit-plugin-wallet` |
| Switches não persistem | MCPs, Skills — estado local only | Backend store |
| Copy wallet | Botão sem `navigator.clipboard` | Implementar handler |
| Chat demo only | Sem streaming LLM | AI SDK + env keys |
| `@agent-rails/sdk` unused | Zero imports nos componentes | `lib/agent-rails.ts` |
| Google auth fake | Email hardcoded | Privy/NextAuth |
| No tests | Zero vitest/playwright | Adicionar smoke tests |
| No turbo dev task | `pnpm dashboard` bypass turbo | Opcional |
| Network install | Usuário precisou npmmirror + concurrency 1 | Documentado em README |

---

## 16. Superteam Earn (integração futura)

API: https://earn.superteam.fun/api/agents/

- Registrar agente: `POST /api/agents`
- Listar bounties: `GET /api/agents/listings/live?type=bounty`
- Submeter: endpoint de submission
- **Humano** reivindica prêmio com `claimCode` — agente não faz KYC

UI proposta: aba Integrations ou seção Earn — agentes buscam bounties compatíveis, humano recebe na wallet conectada.

---

## 17. Comandos úteis para quem implementa

```bash
# Dev
pnpm dashboard

# Typecheck dashboard only
pnpm --filter @agent-rails/dashboard typecheck

# Lint
pnpm lint

# Bootstrap treasury manual (referência)
pnpm agent-rails init --rpc https://api.devnet.solana.com --yes

# Build production
pnpm dashboard:build

# Verificar deps instaladas
ls packages/dashboard/node_modules/next
```

---

## 18. Checklist "done" para considerar funcional

- [ ] Usuário conecta Phantom e vê endereço no header
- [ ] Chat cria workflow real via bootstrap (treasury on devnet)
- [ ] Workflows/Agents/Wallets mostram dados pós-bootstrap (não mock)
- [ ] Treasury mostra saldo real do vault
- [ ] Limits refletem policy on-chain
- [ ] Modo Agent Rails vs Nativo altera fluxo de pagamento
- [ ] Seletor de rede muda RPC em todas as leituras
- [ ] Depositar/Sacar executam tx real (com confirmação UI)
- [ ] API keys salvas server-side, chat usa modelo configurado
- [ ] `pnpm dashboard:build` passa sem erro

---

## 19. Referências no repo

| Doc | Path |
|---|---|
| Arquitetura protocolo | `ARCHITECTURE.md` |
| Estratégia produto | `docs/strategy/product-strategy.md` |
| Contas/instructions byte layout | `docs/spec/accounts-and-instructions.md` |
| MCP tools (agent surface) | `packages/contract/src/mcp-tools.ts` |
| CLI init/bootstrap | `packages/cli/src/commands/init.ts` |
| SDK plugin | `packages/sdk/src/plugin.ts` |
| Dashboard README | `packages/dashboard/README.md` |
| Este handoff | `docs/product/dashboard-handoff.md` |

---

## 20. Resumo executivo (1 parágrafo)

Foi criado o pacote `packages/dashboard` com Next.js 15, React 19, Tailwind v4 e 15 páginas de UI dark-mode alinhadas ao wireframe do usuário (chat-first, sidebar, workflows Netflix-style, treasury, limits, MCPs, RAG, skills, APIs, integrations, harness, account, profile, settings). Toda a camada de dados é mock (`lib/mock-data.ts`); wallet connect funciona apenas com Phantom; chat responde via demo server-side. O SDK e CLI Agent Rails existem no monorepo mas não estão conectados. Próximo passo crítico: API bootstrap + leituras RPC + substituir mocks + LLM chat com tools seguras — respeitando invariantes de privilégio do protocolo.
