# Parecer — ASH × Crypto World's Fair (Colosseum)

**Data:** 21 de setembro de 2026  
**Escopo:** avaliação do que existe hoje no repositório, integridade técnica, apelo para o hackathon e mapeamento de trilhas/prêmios em três tiers.  
**Fontes:** código e testes do repositório, READMEs de pacotes, ARCHITECTURE.md (referência leve), API Colosseum Copilot, regras oficiais do [Crypto World's Fair](https://colosseum.com/legal/Crypto%20World's%20Fair%20Hackathon%20Rules.pdf).

> Este documento **não** usa os briefings de negócio internos (`docs/strategy/*`, `docs/product/*`). É um parecer novo, baseado no que o código entrega e no que o corpus Colosseum mostra sobre concorrentes e tendências.

---

## Resumo executivo

**ASH está tecnicamente íntegro como infraestrutura de pagamentos guardados para agentes de IA na Solana.** O núcleo — programa Anchor, crate de policy pura, SDK, MCP e CLI — forma um stack coerente e testado. O dashboard existe e reforça a demo, mas partes ainda são read-only ou seed local.

**O diferencial real não é “agentes que pagam”** (espaço lotado no corpus Colosseum). É a combinação de:

1. **Garantia on-chain** — limites, allowlist, idempotência e kill switch no programa, não só num proxy off-chain.
2. **Superfície MCP segura por construção** — seis tools, zero escalada de privilégio, identidade do processo ligada no boot.
3. **Idempotência derivada** — `IntentReceipt` + `intent_id` determinístico; proteção contra double-spend em retries (incluindo outcome `indeterminate`).
4. **Profundidade de engenharia rara em hackathon** — proptest, Kani, mutants, baselines de CU, pirâmide de testes em cinco camadas.

**Potencial no hackathon:** realista para **Top 20 geral ($15k)**, **Solana track ($10k)** e **Public Goods ($5k)** com demo + vídeos fortes. **Grand Champion ($30k)** e **aceleradora ($250k)** exigem narrativa de mercado, tração ou caso de uso visceral — hoje o projeto parece mais “infra sólida” do que “produto que judges investiriam amanhã”. Colosseum deixou explícito que, mesmo cross-chain, **o dinheiro de aceleradora continua inclinado a founders Solana** — isso favorece vocês se a história for clara.

**Recomendação de registro:** marcar **Solana** como trilha principal (+ até duas extras só se fizer sentido narrativo). Prêmios gerais são aditivos à trilha.

---

## 1. O que temos em mãos hoje

### 1.1 Stack implementado

| Camada | Pacote / artefato | Estado |
|---|---|---|
| Programa on-chain | `programs/ash` — 23 instruções | Implementado, devnet only, upgrade authority não renunciada |
| Policy pura | `crates/ash-policy` | Implementado, `#![forbid(unsafe_code)]`, aritmética `checked_*` |
| Contrato TS | `packages/contract` | Schemas Zod, reason codes, presets de segurança, `IMMUTABLE_GUARANTEES` |
| Cliente gerado | `packages/client` | Codama a partir do IDL checked-in |
| SDK | `packages/sdk` | PaymentIntent, preflight, send/confirm, policy hooks, remote signer |
| MCP (agente) | `packages/mcp` | 6 tools, governor, guard-rails, quiesce on indeterminate |
| CLI (operador) | `packages/cli` | `init` idempotente, bootstrap completo, bloco MCP pronto |
| Dashboard | `packages/dashboard` | Next.js 15, chat read-only, workflow canvas, leituras on-chain |
| E2E Surfpool | `packages/e2e` | Camada 5, proxy cego para path `indeterminate` |

### 1.2 O que ARCHITECTURE.md promete mas ainda não existe no repo

Estes itens aparecem no baseline de arquitetura, mas **não há código** hoje:

- `packages/indexer` — cadeia de auditoria off-chain / `verifyChain`
- `packages/adapters/*` — LangChain, Vercel AI SDK, OpenAI Agents
- `python/ash` — wrappers Python
- `crates/ash-client` — cliente Rust gerado

Para o hackathon isso **não bloqueia**: MCP + SDK + CLI cobrem o fluxo agente→pagamento. Mas judges que clicarem no README de arquitetura podem achar promessas não cumpridas — convém alinhar pitch ao que está shipped.

### 1.3 Integridade técnica (verificação local, 21/09/2026)

**TypeScript (core):**

| Pacote | Testes |
|---|---|
| `@ash/contract` | 14 passed |
| `@ash/sdk` | 156 passed |
| `@ash/mcp` | 64 passed |
| **Subtotal TS core** | **234 passed** |

**Rust:**

| Suite | Resultado |
|---|---|
| `ash-policy` | 12+ passed (proptest, vectors, rejections) |
| Integração LiteSVM (`programs/ash/tests/*`) | ~156 passed com `.so` apontado; 11 arquivos de teste cobrindo payments, budget, lifecycle, admin, operator, treasury, native_allowance, layout, error_codes, org_chart |
| `pda_owner` | 1 teste depende de `test_pda_relay.so` no mesmo `target/deploy` — falha se o artefato não estiver no `CARGO_TARGET_DIR` do runner |

**Observação:** integração exige `cargo build-sbf` para `ash` e `test_pda_relay`. Em CI com target padrão isso passa; em ambientes com `CARGO_TARGET_DIR` externo, usar `ASH_SO` ou garantir `.so` no deploy dir do target ativo.

**Dashboard:** `pnpm test` falha no build por fetch de Google Fonts (rede). Não é bug de lógica — é dependência de rede no `next/font`. Em CI com rede ou fontes locais, compila.

**E2E:** existe e é deliberadamente nightly (`scripts/verify.sh e2e`), não parte do gate `all`.

**Conclusão de integridade:** o **caminho crítico agente → MCP → SDK → programa → receipt** está implementado e coberto por testes em múltiplas camadas. Gaps são periféricos (indexer, adapters, auth no dashboard, deposit/withdraw na UI) ou operacionais (build SBF, deploy devnet).

---

## 2. Apelo e diferencial de negócio

### 2.1 Problema (com evidência de mercado)

O corpus Colosseum e arquivos citados pela API apontam o mesmo gap:

- Agentes precisam pagar APIs, conteúdo e serviços de forma autônoma (*Agentic Payments*, a16z — *AI needs crypto*, Galaxy Research — *x402 and AI agents*).
- Pagamentos pequenos e repetidos quebram rails tradicionais (Superteam — *Return of the L1 wars: It's all about AI Agents*).
- Empresas temem **gasto descontrolado** e falta de auditabilidade quando delegam carteira a um LLM.

ASH ataca exatamente **blast radius + audit trail + DX para agentes**, não “mais um wallet”.

### 2.2 Posicionamento vs. concorrentes no corpus Colosseum

| Projeto (slug) | Hackathon | Proximidade | Onde ASH difere |
|---|---|---|---|
| **mercantill** | Cypherpunk (Sep 2025) — 4º Stablecoins | Alta — “spending safeguards and audit trails for AI agents” | Vocês provam limites **no programa**; Mercantill enfatiza infra bancária enterprise + Squads Grid |
| **mcpay** | Cypherpunk — 1º Stablecoins | Média — monetiza tools MCP via HTTP 402 | MCPay = **receber** por tool; ASH = **gastar** com guardrails |
| **latinum-agentic-commerce** | Breakout — 1º AI | Média — middleware de pagamento para agentes | Menos evidência on-chain de policy engine formal |
| **riven** | Cypherpunk — Honorable Mention | Alta — “financial control layer for humans and AI agents” | Riven parece produto financeiro completo (invoices, off-ramp); vocês são **primitiva/protocolo** |
| **aegis-11** | Cypherpunk | Alta — “corporate credit cards for LLMs” | Pitch similar; diferenciar com verificação formal + MCP strict surface |
| **blockpal-smart-delegation** | Breakout | Média — “programmable guardrails” | Vocês têm modelo de roles (owner/operator/guardian/agent) mais explícito |
| **bottie** | Frontier | Alta tagline — “Agents with limits.” | Vocês entregam muito mais profundidade técnica |
| **agentvault** | Cypherpunk | Baixa — TWAP/VWAP/DCA execution | Execução DeFi, não treasury de pagamentos |
| **solaibot** | — | Média — toolset para agentes pagarem conteúdo | Vocês são camada de **política**, não marketplace de conteúdo |

**Cluster Colosseum:** “Solana AI Agent Infrastructure” (ex.: `mcpay`, crowdedness ~325) — espaço **competitivo**, mas sub-nicho “on-chain policy floor + MCP safe surface” ainda tem ângulo defensável se a demo mostrar o que ninguém mais prova on-chain.

### 2.3 Os três hooks para judges (Colosseum score como investidores)

Colosseum avalia founder-market fit, insight único, execução, mercado, comunicação, modelo de negócio e tração — **código limpo é table stakes**.

**Hook 1 — “Corporate card on-chain for AI”**  
Metáfora instantânea: dono deposita, operador define política ≤ teto, agente paga só dentro da sessão. Dashboard `ceiling-meter` visualiza a regra de pitch: **ninguém aumenta o próprio teto**.

**Hook 2 — “Prompt injection não escala privilégio”**  
MCP não expõe `create_session`, `withdraw`, `update_policy`. Treasury/session/policy bound at startup. Strict schemas. Isso responde ao medo #1 de CTOs.

**Hook 3 — “Retry-safe by construction”**  
Demo ao vivo: pagamento → RPC cego → `indeterminate` → agente **não** paga duas vezes. Poucos projetos no corpus testam isso de forma tão explícita (blinding proxy em `packages/e2e`).

### 2.4 Modelo de negócio (esboço para pitch, não doc interno)

Possíveis linhas — escolher **uma** na submissão:

- **B2B infra:** fee por treasury ativa ou por volume guardado (SaaS off-chain + programa open source).
- **Protocol fee** em `execute_payment` (requer mudança on-chain — ver Tier 3).
- **Enterprise support / hosted MCP** com SLAs (contradiz parcialmente “public goods”, mas financia OSS).

Judges querem ver **quem paga e por quê**, não só arquitetura.

---

## 3. Potencial para ganhar o hackathon

### 3.1 Contexto do Crypto World's Fair (Sep 14 – Oct 12, 2026)

- **Prêmios totais:** ~$840k em prêmios + $2.5M fundo Colosseum (aceleradora).
- **Trilhas:** por **ecossistema**, não por vertical (AI, DeFi, etc. como nos hackathons anteriores).
- **Até 3 trilhas** por time; prêmios gerais são **aditivos**.
- **Aceleradora ($250k):** Colosseum reforçou que continua backing **founders Solana** — vocês competem nessa lane se contarem a história certa.
- **Campo mais duro:** cross-chain elevou a barra vs. hackathons só Solana (Superteam TR, Sep 2026).

### 3.2 Cenários realistas

| Prêmio | Valor | Probabilidade | O que falta |
|---|---|---|---|
| Solana track (top 10) | $10k | **Média-alta** | Demo devnet + vídeos + narrativa clara vs. Mercantill/Riven |
| Top 20 geral | $15k | **Média** | Pitch investível + polish visual do dashboard |
| Public Goods | $5k | **Média-alta** | Enfatizar OSS Apache-2.0, zero lock-in, MCP spec-friendly |
| University | $5k | Depende do time | Comprovar elegibilidade acadêmica |
| Grand Champion | $30k | **Baixa** | Tração ou insight de mercado excepcional |
| Aceleradora | $250k | **Baixa-média** | Time + mercado + demo que pareça empresa, não só repo |

### 3.3 Forças que ajudam a ganhar

- Profundidade técnica visível (Kani, mutants, CU gates) — diferencia de slides.
- Fluxo ponta a ponta: `ash init` → MCP no Cursor → pagamento real devnet.
- Dashboard já existe (ARCHITECTURE v1 dizia non-goal; hoje é **ativo** para demo).
- Timing: agentic payments é tema quente em arquivos Colosseum de 2025–2026.

### 3.4 Fraquezas que prejudicam

- **Devnet only, 0.x, não auditado** — honestidade é boa, mas judges comparam com projetos “mainnet-ready”.
- **Infra vs. produto:** difícil emocionar jurados sem história de usuário (“nossa API de hosting paga X/mês via agente”).
- **Concorrência direta** já premiada (Mercantill, MCPay, Latinum).
- **Dashboard incompleto** para ações on-chain (deposit/withdraw/treasury create na UI = CLI).
- **Promessas ARCHITECTURE** (indexer, adapters) não shipped — risco de credibilidade se citadas.

---

## 4. Trilhas e prêmios — mapa em 3 tiers

O Crypto World's Fair organiza prêmios em **8 trilhas de ecossistema** + **prêmios gerais**. Não há trilha “AI” ou “Stablecoins” separada nesta edição — o encaixe vertical é feito na **narrativa e demo**, não no formulário.

### Tier 1 — Sem mudar código (só posicionamento, conteúdo, registro, demo)

| Alvo | Esforço | Como encaixar ASH |
|---|---|---|
| **Trilha Solana** | Registrar + submeter | Já é Solana nativo. Demo: `init` → MCP → `execute_payment` devnet USDC/SOL. |
| **Public Goods Award ($5k)** | Pitch + README | OSS Apache-2.0, programa como primitiva, MCP aberto, sem hosted obrigatório. |
| **University Award ($5k)** | Documentação | Se elegível: destacar pesquisa em policy verification (Kani/proptest). |
| **Top 20 geral ($15k cada)** | Vídeos + deck | Pitch 3 min + demo 3 min (regras Colosseum). Foco em problema + diferencial on-chain. |
| **Grand Champion ($30k)** | Narrativa | Mesmo produto; exige storytelling de mercado grande e execução impecável nos vídeos. |
| **Narrativa “AI agents” dentro da trilha Solana** | Copy + demo script | Mostrar Cursor/Claude pagando fatura via MCP com limites visíveis no dashboard. |
| **Narrativa “stablecoins / USDC”** | Demo config | `ash init --mint <devnet USDC>` — já suportado pelo CLI. |
| **Squads como owner** | Doc + setup | ARCHITECTURE já prevê owner = PDA Squads; só documentar bootstrap para demo enterprise. |

### Tier 2 — Ajustes moderados (dias a ~1–2 semanas)

| Alvo | Esforço | O que fazer |
|---|---|---|
| **Demo USDC/SPL end-to-end polida** | Médio | Garantir init com mint real devnet, vídeo mostrando token path (hoje E2E é SOL-only). |
| **Audit chain visível** | Médio | CLI `audit` ou painel no dashboard lendo `audit_head` / eventos — indexer lite sem Postgres. |
| **Integração narrativa x402** | Médio | Posicionar como stack complementar: x402 paga **APIs inbound**; ASH guarda **outbound treasury**. Adapter HTTP opcional, não reescrita. |
| **Dashboard: bootstrap treasury from zero** | Médio | Deposit/withdraw SPL+SOL já estão no dashboard; `create_treasury` no browser continua ADR-021 wave 2 — demo segue com `ash init`. |
| **Deploy devnet público + endereço fixo** | Médio | Program id conhecido, faucet script, reduce friction para judges. |
| **Adapter LangChain ou Vercel AI SDK** | Médio | Um pacote fino em `packages/adapters/*` — ARCHITECTURE promete; um adapter basta para hackathon. |
| **Case study vertical** | Baixo código | Ex.: “agente paga OpenAI/Anthropic/hosting” com allowlist labels — config + conteúdo. |
| **Trilha Zcash (secundária)** | Médio-alto | Só se houver ângulo “private agent payments” — provavelmente fraco sem privacy no programa. |

### Tier 3 — Mudanças grandes (replatform ou produto diferente)

| Alvo | Esforço | Por que é Tier 3 |
|---|---|---|
| **Tempo / Hyperliquid / Ethereum / Base / Arbitrum / Robinhood** | Muito alto | Exige portar contrato ou bridges; ASH é Solana-specific (Anchor, SPL, native allowance ADR-014). |
| **MCPay-like x402 como produto principal** | Alto | Mudaria foco de treasury guardrails para monetização de tools; arquitetura centrada em HTTP 402, não vault PDA. |
| **AgentVault-like DeFi execution** | Alto | TWAP/VWAP/DCA é outro produto; programa hoje só faz transfer guardado. |
| **Yield / RWA treasury (atlas-rwa-vault)** | Alto | Rebalanceamento DeFi ≠ payment guardrails. |
| **Token-2022 confidential / transfer hooks** | Alto | Explicitamente non-goal v1; extensões bloqueadas. |
| **Indexer completo + Postgres + Yellowstone** | Alto | Pacote inteiro ausente; semanas de trabalho. |
| **Mainnet + audit + authority renounced** | Alto | ADR-011 phased release; não realista em 3 semanas. |
| **Protocol fee on-chain** | Médio-alto | Nova instrução + implicações de tokenomics/governance. |
| **Marketplace agent-to-agent (XAAM)** | Alto | Produto diferente (matching/hiring agents). |

---

## 5. Recomendações práticas até 12 de outubro

### Semana 1 (agora – 28 set): narrativa + demo core

1. Escolher **um** vertical story (ex.: “AI ops agent paying SaaS bills with USDC caps”).
2. Gravar demo: terminal `init` → MCP tool call → tx devnet → dashboard mostrando spend vs. policy.
3. Preparar pitch de 3 min: problema → por que on-chain floor → demo → modelo de negócio → ask.
4. Registrar trilha **Solana** + considerar **Public Goods** na copy (não é trilha separada, é prêmio geral).

### Semana 2 (29 set – 5 out): polish

5. Resolver gap mais visível: **USDC path na demo** ou **audit trail legível**.
6. Alinhar slide/deck com o que **existe** — não citar indexer/adapters como shipped.
7. `pnpm dashboard:build` com fontes offline ou fallback local para CI/demo machine.

### Semana 3 (6 – 12 out): submissão

8. Vídeo técnico mostrando **indeterminate / no double-spend** (diferencial forte).
9. Repo público, README de hackathon curto apontando para `init` + MCP config.
10. Submeter Arena + materiais em inglês (requisito Colosseum).

---

## 6. Veredicto final

| Dimensão | Nota | Comentário |
|---|---|---|
| Integridade técnica | **8/10** | Core sólido e testado; gaps periféricos e dashboard parcial |
| Diferenciação | **7/10** | On-chain floor + MCP strict + idempotency; tagline “agents with limits” não é única |
| Fit hackathon Solana | **8/10** | Infra agentic payments é tema central; trilha Solana natural |
| Probabilidade prêmio ($5k–$15k) | **Média-alta** | Com demo e vídeos bem executados |
| Probabilidade aceleradora | **Média-baixa** | Precisa parecer startup, não só framework |
| Esforço Tier 1 vs. retorno | **Excelente** | Registrar Solana + Public Goods narrative + vídeos |
| Esforço Tier 2 prioritário | **Audit visível + USDC demo + case study** | Máximo ROI em poucos dias |

**Frase para a submissão:**  
*ASH is the on-chain spending policy layer for AI agents on Solana — a programmable corporate card where the program, not the MCP server, is the guarantee.*

---

## Apêndice — referências Colosseum citadas

- Projetos: `mercantill`, `mcpay`, `latinum-agentic-commerce`, `riven`, `blockpal-smart-delegation`, `bottie`, `agentvault`, `aegis-11`, `solaibot`
- Arquivos: *Agentic Payments and Crypto's Emerging Role in the AI Economy* (Galaxy Research, Jan 2026); *AI needs crypto — especially now* (a16z, Feb 2026); *Return of the L1 wars: It's all about AI Agents* (Superteam, Sep 2025)
- Hackathons no corpus (ordem cronológica): Renaissance (Mar 2024) → Radar (Sep 2024) → Breakout (Apr 2025) → Cypherpunk (Sep 2025) → Frontier (Apr 2026)

*Gerado com Colosseum Copilot skill v1.2.1 e inspeção direta do repositório ash.*
