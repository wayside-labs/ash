# Agent Rails Dashboard — Handoff de implementação

**Criado:** 2026-09-19 · **Atualizado:** 2026-09-20
**Pacote:** `packages/dashboard` (`@agent-rails/dashboard`)

> ## Atualização — 2026-09-20: o dashboard deixou de ser mock
>
> O plano descrito abaixo foi executado. O que mudou:
>
> - **Program em devnet.** `4qjD6vSgYa3oBKde3KVzsH8oCcP9BKsirX1xtD5SS6BS` está
>   deployado, authority `5eznzq18xdeVaagEkyo7DYb8v12mAWmYcz6AdWTnH8JQ`. Antes não
>   estava em rede nenhuma, o que tornava impossível qualquer leitura real — e o
>   handoff original não registrava isso.
> - **`lib/mock-data.ts` não existe mais.** O estado vive em
>   `~/.agent-rails/dashboard.json` (escrita atômica, modo 600), servido por rotas
>   CRUD com validação Zod. Linhas de demonstração continuam existindo, marcadas
>   `demo: true` e rotuladas na UI.
> - **Leituras on-chain reais** via `@agent-rails/sdk`: saldos, Treasury, Policy e
>   AgentSession com contadores de gasto e decimais do mint.
> - **Chat real** com Claude, com streaming e quatro
>   ferramentas *somente leitura*. Sem chave, cai em modo demonstração explícito.
> - **Chaves de API no servidor.** A API só devolve máscara; o valor nunca chega ao
>   navegador.
> - **Os ~24 botões sem handler** foram ligados, ou substituídos por um estado
>   honesto ("ainda não existe") com o comando de CLI equivalente ao lado.
>
> - **Chat sem API key.** O provedor padrão passou a ser o **Claude Code local**
>   em modo headless, usando a assinatura Claude do usuário. Sem chave, sem custo
>   por token. O adaptador não lê o token OAuth guardado — ele tem escopo
>   `user:sessions:claude_code`, então o caminho certo é acionar o cliente
>   licenciado, não imitá-lo. Só funciona com o dashboard rodando na mesma
>   máquina do CLI.
> - **Saldo do cofre corrigido.** A página mostrava o *rent* da conta Treasury
>   (0,0054 SOL) como se fosse o cofre; o dinheiro está no PDA `sol_vault`
>   (0,2006 SOL) — 37x de diferença. Passou a resolver o vault.
>
> - **RAG, Harness e Integrations foram removidas** — páginas e entradas de
>   navegação. Nenhuma tinha backend por trás, e uma entrada na sidebar é uma
>   promessa. As coleções `rag` e `integrations` seguem no schema para que um
>   `dashboard.json` existente continue a fazer parse; nada as semeia nem as
>   renderiza. As subseções RAG, Integrations e Harness da §12 (spec UX) ficam
>   como registro do desenho original.
> - **Editar workflow e agente.** Antes só era possível criar e remover:
>   `EditWorkflowDialog` e `EditAgentDialog` agora fazem `PATCH` nas rotas
>   genéricas `/api/state/[resource]/[id]`, e o estado devolvido entra direto no
>   cache do TanStack Query — a lista rerenderiza sem refetch. Endereços passam
>   por validação base58 antes do submit, nos dialogs de criar e de editar.
>
> As seções 5, 6, 11, 15 e 18 foram atualizadas. O restante permanece como registro
> do desenho original e do raciocínio de produto.

**Objetivo original deste doc:** servir como referência para tornar o dashboard funcional (substituir mocks, conectar SDK/CLI, auth, chat real).

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
    │       ├── skills/page.tsx
    │       ├── apis/page.tsx
    │       ├── treasury/page.tsx
    │       ├── limits/page.tsx
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

| Rota | Dados | Ações funcionais |
|---|---|---|
| `/` | store + RPC | chat com streaming, criar e editar workflow/agente |
| `/workflows` | store + RPC | criar/editar/remover workflow, adicionar e editar agente, scroll |
| `/agents` | store + RPC | criar, editar, pausar/ativar, remover |
| `/wallets` | store + RPC | copiar endereço, abrir no explorer, saldo SOL real |
| `/treasury` | store + RPC | ler Treasury/Policy/Session on-chain, copiar, explorer |
| `/limits` | store | barras por agente, marca on-chain vs só-dashboard |
| `/mcps` | store | criar, alternar (persiste), remover |
| `/skills` | store | criar, alternar (persiste), remover, abas por escopo |
| `/apis` | store | salvar chave no servidor, mostrar máscara, remover |
| `/account` | zustand | conectar/desconectar carteira |
| `/profile` | store | editar e salvar perfil |
| `/settings` | store + zustand | testar RPC, exportar, restaurar padrões, preferências |

Depositar e sacar continuam desabilitados **de propósito**: movem dinheiro real e
exigem construção e assinatura de transação pelo dono. A UI aponta o comando de
CLI em vez de oferecer um botão que não faz nada.

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

## 6. O que é REAL vs ainda não existe

### Real

| Feature | Onde |
|---|---|
| Persistência de tudo que você cria | `~/.agent-rails/dashboard.json`, escrita atômica, modo 600 |
| CRUD com validação | `src/lib/schema.ts` (Zod) + `app/api/state/**` |
| Saldos SOL | `POST /api/solana/balances`, revalida a cada 30s |
| Treasury, Policy, AgentSession | `GET /api/solana/treasury` — decodifica contas reais |
| Decimais do mint | `getMultipleAccounts` com `jsonParsed` |
| Chat com Claude | `POST /api/chat`, streaming, 4 tools read-only |
| Chaves de API | gravadas no servidor; a API só devolve máscara |
| Connect wallet | Phantom, Solflare, Backpack, com detecção do provider |
| Teste de RPC | `POST /api/solana/rpc-health` |
| Guarda de SSRF | RPC customizado: só https e host público |

### Ainda não existe (e a UI diz isso)

| Feature | O que falta |
|---|---|
| Depositar / Sacar | construir e assinar a transação no navegador |
| Criar treasury pela UI | hoje via `pnpm agent-rails init` |
| Login Google / email | provedor de identidade com sessão no servidor |
| Preço em USD | não há oráculo ligado; saldos aparecem em SOL |

RAG e Harness saíram desta tabela porque saíram da UI: em vez de uma página que
diz "ainda não existe", não há página. Voltam quando houver pipeline de embeddings
e runtime Docker por trás.

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

## 11. Roadmap de implementação

### Fase 1 — feito (2026-09-20)

- [x] **1.0** Deploy do program em devnet (era pré-requisito não registrado)
- [x] **1.1** Cliente Kit server-side por cluster — `src/lib/server/solana.ts`
- [x] **1.2** Wallet: Phantom, Solflare e Backpack com detecção de provider
- [x] **1.4** Persistência — `~/.agent-rails/dashboard.json` + rotas CRUD
- [x] **1.5** Mock substituído; linhas de demonstração marcadas `demo: true`
- [x] **1.6** Treasury lendo saldo real; Policy e Session decodificadas
- [x] **1.7** Chat com LLM real e tools somente leitura

### Fase 2 — feito

- [x] **2.1** Limits/Treasury lendo Policy e contadores de Session on-chain
- [x] **2.3** Chaves de API salvas no servidor, nunca devolvidas ao navegador
- [x] **2.5** Pausar agente persiste (revogar sessão on-chain segue sendo do operador)

### Continua em aberto

- [ ] **1.3** `POST /api/bootstrap` — criar treasury pela UI (hoje: CLI)
- [ ] **1.6b** Depositar/Sacar: construir e assinar transação no navegador
- [ ] **2.2** Derivar endereços de agente a partir das sessões on-chain
- [ ] **2.4** Gerar snippet de config MCP pós-init na página `/mcps`
- [ ] **3.1** Google OAuth real (Privy/NextAuth)
- [ ] **3.2** RAG: upload + indexação
- [ ] **3.4** Harness: API Docker para start/stop e logs
- [ ] **3.5** Superteam Earn
- [ ] **3.6** Indexer para histórico de pagamentos
- [ ] Oráculo de preço para exibir USD junto do SOL
- [ ] Testes: o pacote ainda não tem vitest nem playwright

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

| Issue | Situação |
|---|---|
| Dados 100% mock | **resolvido** — store no servidor + leituras RPC |
| Phantom only | **resolvido** — Phantom, Solflare, Backpack |
| Switches não persistem | **resolvido** — gravam via PATCH |
| Copy wallet sem clipboard | **resolvido** — com toast de confirmação |
| Chat demo only | **resolvido** — Claude com streaming; demo é fallback explícito |
| `@agent-rails/sdk` sem uso | **resolvido** — usado em `lib/server/solana.ts` |
| Google auth falso | **removido** — não fingir sessão que não existe |
| Sem testes | **em aberto** — zero vitest/playwright no pacote |
| Preço em USD | **em aberto** — sem oráculo; exibimos SOL |
| Task `dev` no turbo | **em aberto** — `pnpm dashboard` continua fora do turbo |
| Chat sem chave real testada | o caminho LLM não foi exercitado ao vivo (não havia credencial na máquina) |

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

## 18. Checklist "done"

- [x] Usuário conecta carteira e vê o endereço no header
- [x] Workflows/Agents/Wallets vêm do store, não de mock
- [x] Treasury mostra saldo real do vault na rede selecionada
- [x] Limits refletem a política on-chain (no detalhe do cofre)
- [x] Seletor de rede troca o RPC em todas as leituras
- [x] Chaves de API salvas no servidor; chat usa o modelo configurado
- [x] `pnpm dashboard:build` passa sem erro
- [x] `pnpm lint` e `typecheck` limpos
- [ ] Chat cria workflow real via bootstrap (tool de escrita — decisão de segurança: não expor)
- [ ] Depositar/Sacar executam transação real
- [ ] Modo Agent Rails vs Nativo altera o fluxo de pagamento de fato

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

## 20. Resumo executivo

`packages/dashboard` é um dashboard Next.js 15 / React 19 / Tailwind v4 com 15
páginas em português. O estado do usuário persiste em `~/.agent-rails/dashboard.json`
através de rotas CRUD validadas por Zod; saldos, Treasury, Policy e AgentSession são
lidos da rede via `@agent-rails/sdk`, com o program deployado em devnet. O chat roda
Claude com streaming e quatro ferramentas somente leitura — nenhuma que saque,
altere política, despause ou crie sessão, porque a superfície voltada ao agente não
pode escalar privilégio. O que ainda não existe (depósito/saque, criação de treasury
pela UI, indexação de RAG, runtime do Harness, login por email) aparece na interface
como tal, com o comando de CLI equivalente, em vez de um botão inerte.
