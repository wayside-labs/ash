# Agent Rails — Playbook de Mercado, Pitch e Hackathon

**Data:** 2026-09-17 · **Hackathon:** [Crypto World's Fair](https://colosseum.com/worldsfair), 14/09 – **12/10/2026** (25 dias)
**Para:** reunião de time — viabilidade de mercado, frentes a atacar, discurso do pitch, concorrência e precificação
**Consolida:** `docs/research/revenue-model-analysis.md`, `docs/research/agent-orgs-and-defi-mandates.md`, `docs/research/gate402-comparison.md`, `docs/research/colosseum-copilot-competitive-landscape.md`

> **Como usar este documento na reunião:** §1 é a pauta e as decisões que precisam sair de lá. §2–§4 são munição (demo, pitch, concorrência). §5–§8 são a discussão de negócio, com preços. §9–§12 são execução. Se o tempo for curto, leia §1, §5.2, §7 e §8.

### Índice

| § | Seção | Para quê |
|---|---|---|
| [0](#0-onde-estamos-hoje) | Onde estamos hoje | O estado real do projeto em uma tabela |
| [1](#1-pauta-da-reunião--as-seis-decisões) | Pauta da reunião | As seis decisões que precisam sair da reunião |
| [2](#2-a-demo-do-organograma) | A demo do organograma | O que lidera o pitch |
| [3](#3-o-pitch) | O pitch | Uma linha, 30s, 60s, versão técnica, números, objeções |
| [4](#4-concorrência--o-mapa-completo) | Concorrência | Quem já existe, e quem é concorrente de verdade |
| [5](#5-posicionamento-e-frentes) | Posicionamento | A categoria, a vantagem real e o que nunca dizer |
| [6](#6-estratégia-de-mercado) | Estratégia de mercado | Primeiro usuário, distribuição, relação com x402 |
| [7](#7-modelos-de-negócio--as-nove-linhas) | Modelos de negócio | As nove linhas de receita, ranqueadas |
| **[8](#8-precificação)** | **Precificação** | **Âncoras de mercado e os preços de cada linha** |
| [9](#9-as-trilhas-do-hackathon) | Trilhas do hackathon | Prêmios, encaixe e qual trilha declarar |
| [10](#10-critérios-de-julgamento-e-onde-investir) | Critérios de julgamento | Onde somos fortes e onde investir o esforço restante |
| **[11](#11-cronograma--25-dias-até-a-submissão)** | **Cronograma** | **Os 25 dias, dia a dia, com gates e caminho crítico** |
| [12](#12-decisões-irreversíveis-com-prazo) | Decisões irreversíveis | O que deixa de ser reversível, e quando |
| [13](#13-riscos) | Riscos | O que pode dar errado e a mitigação |
| [14](#14-a-frase-para-terminar-qualquer-conversa) | A frase final | Como terminar qualquer conversa |

---

## 0. Onde estamos hoje

| | |
|---|---|
| Programa | 23 instruções, completo, LiteSVM cobrindo todas |
| Crate de política | `no_std`, `forbid(unsafe_code)`, proptest + fuzz + **provas Kani**, 99,2% de cobertura |
| TypeScript | `contract`, `client` (Codama), `sdk`, `mcp` — verdes |
| Testes | **161 Rust + 129 TS**, sem validador necessário |
| Demo de organograma | `programs/agent_rails/tests/org_chart.rs` — **novo, passando** |
| Governança | 15 ADRs · Apache-2.0 · sem CLA |
| **Não temos** | **auditoria · mainnet · CLI · indexer · um único usuário** |

Duas frases para calibrar a reunião:

1. **O produto técnico está pronto o suficiente; a distribuição não existe.** Nenhuma das nove linhas de receita começa antes da auditoria, e a auditoria custa $30–80k que ainda não temos.
2. **O comprador ainda não foi verificado.** Em 2.992 projetos de hackathon analisados, "gasto descontrolado de agente" não aparece entre as dores frequentes — só um projeto ataca isso diretamente. Ou estamos cedo, ou a dor é menor do que parece. **Descobrir qual das duas é a coisa mais urgente deste documento.**

---

## 1. Pauta da reunião — as seis decisões

| # | Decisão | Opções | Minha recomendação |
|---|---|---|---|
| 1 | **Isto é empresa ou bem público que se financia?** | Empresa VC-backed · bem público com grants · híbrido (core aberto + nuvem fechada) | **Híbrido.** O core precisa ser aberto e congelado para a garantia ser crível; a nuvem é onde há receita. Mas isso exige a decisão #2 antes do primeiro PR externo |
| 2 | **Repositório comercial separado, agora?** | Sim, criar já · decidir depois | **Sim, agora.** Apache-2.0 sem CLA torna relicenciamento impossível depois do primeiro PR de terceiro. Custo hoje: zero. Custo depois: irreversível |
| 3 | **Taxa de protocolo na v1?** | Sim · Não · adiar | **Não, e registrar em ADR.** Irreconciliável com o congelamento do programa; removível em uma linha num fork; taxa a adoção que não temos. Deixar a porta aberta para taxa numa 2.x |
| 4 | **Qual frente atacar primeiro?** | Guardião · Indexer/console · Controladoria · Consultoria | **Grant + auditoria primeiro** (nada mais destrava). Depois indexer (substrato) → guardião (diferenciado) |
| 5 | **Quem é o primeiro usuário-alvo?** | Dev solo · empresa com agentes | **Dev solo para aquisição, empresa para narrativa e receita.** Muda docs, preço e onboarding |
| 6 | **O hackathon é prioridade nos próximos 25 dias?** | Sim, tudo nele · parcialmente · não | **Sim.** $840k em prêmios + $2,5M de capital + $250k de aceleradora, e o trabalho que ele exige (CLI, demo, narrativa) é exatamente o que falta de qualquer forma |

**Pergunta aberta que só o time responde:** quantas horas/semana cada pessoa tem, de verdade, nos próximos 25 dias? Todo o plano da §11 depende disso e não adianta planejar contra horas que não existem.

---

## 2. A demo do organograma

### 2.1 O que é

`programs/agent_rails/tests/org_chart.rs` — um teste LiteSVM que monta **uma empresa inteira de agentes** usando só as instruções que já existem:

```bash
cargo test -p agent_rails --test org_chart -- --nocapture
```

```
AGENT RAILS — um organograma feito de contas
────────────────────────────────────────────────────────────────────────────
HQ                           vault   $175,000.00   teto/tx  $25,000.00
  └─ agente-cfo              gastou   $25,000.00   pagamentos 2   audit cb35e2b4

  PESQUISA                   vault     $4,520.00   teto/tx     $500.00
    ├─ scout-mercado         gastou      $300.00   pagamentos 2   audit 5c8d9fec
    └─ analista-token        gastou      $180.00   pagamentos 1   audit ffbc1b59

  OPERACOES                  vault    $18,000.00   teto/tx   $5,000.00
    ├─ compras-infra         gastou    $1,200.00   pagamentos 1   audit d33c5097
    └─ compras-saas          gastou      $800.00   pagamentos 1   audit 2399d0a4
────────────────────────────────────────────────────────────────────────────
```

### 2.2 O truque — duas linhas de código que já existiam

1. `execute_payment.rs:78` — `destination_owner` é um `UncheckedAccount` que o programa **nunca lê**. Nada exige que seja uma carteira.
2. `add_mint.rs:188` — o cofre de uma tesouraria é a **ATA comum da `Treasury` PDA**.

Logo, cadastrar a PDA de uma tesouraria-filha como destino permitido faz o pagamento **cair no cofre dela**, que gasta sob teto, política, contadores e cadeia de auditoria próprios. *O organograma é um layout de contas.* Zero instruções novas.

### 2.3 O que o teste prova

| Afirmação | Como |
|---|---|
| Alocação desce a árvore | HQ paga $5k/$20k aos departamentos; saldos assertados em base units |
| Orçamento é por agente, não por política | Dois agentes na mesma política com $300 e $180 gastos |
| Afrouxar só desce | Operadora tenta política acima do teto → `PolicyExceedsCeiling` |
| Uma chave fria define todos os tetos | As três tesourarias criadas pelo mesmo `owner` |
| Pause é por tesouraria | Guardião pausa Operações → `Paused`; Pesquisa segue pagando |
| **Pause NÃO cascateia** *(lacuna assertada de propósito)* | Pausar a HQ não trava os departamentos |
| Saque do dono funciona pausado | Com HQ pausada, `withdraw` move $1.000 |
| Cadeia de auditoria por nível | Primeiro elo recomputado off-chain, como um indexer faria |

### 2.4 Por que vale mais que um slide

Um jurado que roda um comando e vê a árvore aparecer não precisa acreditar em ninguém. E como é teste, entra no CI: a afirmação não apodrece em silêncio.

---

## 3. O pitch

### 3.1 Uma linha

> **Agent Rails é a camada de tesouraria e prestação de contas para organizações de agentes de IA: o dono deposita, define tetos, e o agente paga por um programa que recusa tudo que sair da política.**

### 3.2 Trinta segundos

> Quando você dá a um agente de IA uma carteira, você dá a ele tudo que tem nela. A resposta do mercado hoje é emitir um cartão virtual com limite — funciona para comprar um tênis, não funciona para uma empresa rodando cinquenta agentes.
>
> Agent Rails é um programa Solana: o dono deposita num cofre e define tetos, um operador define políticas que **têm de ser menores** que esses tetos, e o agente recebe uma sessão com prazo. Uma única instrução paga, e o programa recusa se qualquer regra falhar. A chave do agente autoriza um pagamento; ela nunca autoriza um limite.
>
> A garantia não é o nosso servidor — é o programa. Você confere em dez segundos.

### 3.3 Sessenta segundos (versão hackathon)

> Um agente comprometido — chave vazada, prompt injection, loop de retry com bug — perde no máximo o que a política permite na janela atual. Não é promessa nossa, é propriedade do programa.
>
> Quatro papéis com poderes enumerados: o dono define tetos, o operador define política dentro do teto, o guardião só pausa e nunca despausa, o agente não define nada. Afrouxar só flui morro abaixo.
>
> Idempotência por construção: o `intent_id` é derivado do pagamento, nunca sorteado, e cria um PDA de recibo — um retry colide na criação da conta, antes de qualquer transferência. A superfície MCP do agente não tem uma única ferramenta que escale privilégio, e isso é um teste, não uma convenção.
>
> E como um pagamento pode ir para qualquer dono de conta, inclusive outra tesouraria, você monta uma empresa: departamentos com teto próprio, agentes com mesada própria, uma cadeia de hash por sessão onde **apagar um registro é detectável**. Rode um comando e o organograma aparece no terminal.

### 3.4 A versão técnica (para quem lê código)

- **Programa fino, política pura.** Limite, rolagem de janela, ordem parcial de teto e hash de auditoria vivem em `crates/agent-rails-policy`: `#![no_std]`, `#![forbid(unsafe_code)]`, `#![deny(clippy::arithmetic_side_effects)]`, `checked_*` em tudo. Proptest, fuzzing e **provas Kani** — sem SVM.
- **`execute_payment` = 1 instrução + 1 CPI de token.** ≤45k CU, com baseline versionada em CI que falha em regressão >10%.
- **Zero dependências de programa externo** além de SPL Token / Token-2022 / ATA / System.
- **Contas versionadas com padding, layout com snapshot em CI** — v1.1 entra sem migração.
- **Pirâmide de 5 camadas** (ADR-008): 161 testes Rust + 129 TS; 99,2% de cobertura na política, 89,4% no SDK.
- **15 ADRs** imutáveis registrando cada decisão.

### 3.5 O slide de números

```
23 instruções · 161 testes Rust · 129 testes TS · 99,2% cobertura na política
provas Kani nas 4 propriedades · ≤45k CU por pagamento · 0 dependências externas
15 ADRs · Apache-2.0 · programa será congelado (upgrade authority → None)
```

### 3.6 Objeções e respostas

| Objeção | Resposta |
|---|---|
| *"A Solana já tem Subscriptions & Allowances nativo."* | Tem, e é um **teto único delegado**. Não tem sessão com quatro limites simultâneos, nem allowlist de destino + de mint, nem separação dono/operador/guardião, nem cadeia de auditoria. É o primitivo; somos a governança. E **integramos** com ele: o modo `NativeAllowance` (ADR-014) usa o programa nativo como fonte de fundos |
| *"Por que não Squads com limite de gasto?"* | Squads limita **membros de um multisig**. Não tem sessão de agente com prazo, contadores por agente nem trilha por agente. E o nosso `owner` **pode ser** um PDA do Squads — testado em `tests/pda_owner.rs`. Complemento, não concorrente |
| *"Um cartão virtual com limite resolve."* | Para comprar de lojista, sim, e melhor que nós. Cartão não paga outra carteira, não paga outro agente, não faz sub-centavo, exige emissor e portador humano, e entrega extrato — não prova de que nada foi omitido |
| *"O agente não pode driblar a MCP?"* | Pode, e não adianta: a MCP é conveniência, o programa é a garantia. Com a chave de sessão na mão ele ainda não excede limite, não paga fora da allowlist e não paga o mesmo intent duas vezes |
| *"E se vocês forem comprometidos?"* | Não temos chave no caminho. No produto de guardião, o pior que um serviço totalmente comprometido faz é **desligar o agente do cliente** — guardião não despausa, não saca, não configura |
| *"Está auditado?"* | Não, e está no README em negrito. É `0.x`, devnet. A auditoria é a próxima meta, orçada na ADR-011 |
| *"Por que alguém adotaria mais um programa para auditar?"* | Essa é a objeção mais honesta e a resposta é: só adota quem tem mais de um agente e precisa provar o gasto. Para um agente só, o primitivo nativo basta — e devemos dizer isso |

---

## 4. Concorrência — o mapa completo

> Consolidado das quatro pesquisas. Classificação: 🔴 ameaça · 🟡 sobreposição parcial · 🟢 complemento/integração · ⚪ adjacente

### 4.1 Primitivo on-chain de limite de gasto

| Quem | O que faz | Classe | Nota |
|---|---|---|---|
| **Solana Subscriptions & Allowances** (nativo, mainnet, auditado Cantina/Spearbit) | Delegado gasta até um teto, com expiração; revogável | 🔴🟢 | **A maior ameaça de commoditização e ao mesmo tempo nossa integração** (ADR-014). Se estender para multi-limite ou allowlist, nossa vantagem de núcleo estreita. Acompanhar o roadmap |
| **Squads Spending Limits** | Limite por membro sem proposta de multisig | 🟢 | Nosso `owner` pode ser um vault PDA deles |
| **Swig** (Anagram) | Smart wallet com session keys, permissões delegadas, limites por tipo de ação e tempo | 🟡 | Mais perto de "permissão por ação"; camada de carteira, não de tesouraria |

### 4.2 Governança de agente off-chain

| Quem | O que faz | Classe | Nota |
|---|---|---|---|
| **Mercantill** (Cypherpunk, **4º Stablecoins, $10k**) | "Spending safeguards and audit trails for AI agents", sobre Squads Grid | 🔴 | **O concorrente direto mais próximo no corpus.** Time de 1 pessoa. Diferença: eles compõem sobre multisig (garantia = Squads + servidor deles), nós somos o programa |
| **Privy** | Políticas off-chain: limites de transferência, protocolos aprovados, janelas de tempo | 🟡 | Enforcement off-chain — contraste direto com nossa tese |
| **Coinbase Agentic Wallets** | MPC, session caps, x402 nativo | 🟡 | Mesma observação |
| **Lit Protocol Vincent** | Permissões de agente governadas por política, cross-chain | 🟡 | Concorrente na camada de permissão |
| **Blockpal Smart Delegation** (Breakout) | "Programmable guardrails" para agentes | ⚪ | Sem cadeia de auditoria nem separação de papéis documentada |

### 4.3 Comércio agêntico / trilhos de cartão — **o concorrente real hoje**

| Quem | O que faz | Classe | Nota |
|---|---|---|---|
| **Bido** ([usebido.com](https://www.usebido.com/)) | MCP no ChatGPT/Claude + DM no Instagram; compra com cartão virtual de uso único travado no lojista, com teto e prazo; passkey por compra; tokenização Basis Theory; PCI DSS L1; ~15 lojistas | ⚪ | **Mesmo primitivo conceitual, mercado diferente.** Põe humano em cada compra — correto para consumidor, fatal para organização. Modelo de receita: quase certamente afiliado (inferência) |
| **Visa Intelligent Commerce** | Credenciais tokenizadas, identidade de agente (Trusted Agent Protocol), liquidação em stablecoin a **~$7 bi de run-rate anual em 9 blockchains** | 🔴 | Quando alguém pergunta "como limito o gasto do agente", esta é a resposta de mercado |
| **Stripe + OpenAI ACP** | Instant Checkout dentro do ChatGPT | 🔴 | Distribuição que não temos como igualar |
| **Nekuda** ($5M seed — Madrona, Amex Ventures, Visa Ventures) | SDK de pagamento agêntico: "Secure Agent Wallet" + **"Agentic Mandates"** | 🔴 | O nome deles para o nosso `Policy` |
| **Basis Theory** ($33M Série B) | Tokenização; co-fundou o Agentic Commerce Consortium | ⚪ | Infra embaixo da Bido |
| **Skyfire** ($9,5M — a16z CSX, Coinbase Ventures) | Identidade e pagamento de agente | 🟡 | |

> ~$50 mi divulgados só na camada de pagamento e identidade, e **seis protocolos** disputando o padrão (ACP, UCP, AP2, MCP, A2A, Visa TAP).

### 4.4 Mandato DeFi para agentes — **todos em EVM**

| Quem | O que faz | Classe | Nota |
|---|---|---|---|
| **Brahma ConsoleKit** | Sub-contas Safe, cada uma governada por **policy engine modular**; usuário mantém custódia; agentes verticais em cima (Morpho Agent) | 🔴 | É literalmente o que seria um "Agent Rails DeFi", construído, em Ethereum |
| **Giza / ARMA** | Agente de rendimento em stablecoin; **~$3,96 bi de volume agêntico** até mar/2026, 25k+ instâncias, $35 mi otimizados | 🔴 | Escala real |
| **Almanak** | SDK Python + swarm de 18 agentes; não-custodial via smart accounts com permissões auditáveis | 🔴 | |

**Conclusão:** não entrar nessa briga. Três anos atrás, ecossistema errado, e quebra nossa meta de zero dependências externas. A fronteira certa é **alocação, não operação**.

### 4.5 Complementos — quem devemos integrar, não combater

| Quem | Por quê |
|---|---|
| **Solana Agent Kit** (SendAI) | O executor. Compara taxas entre Kamino, MarginFi, Drift, Jupiter Lend, Loopscale. Sem guardrail nenhum — é exatamente quem nosso modelo de alocação financia |
| **Drift delegated accounts** | A conta é do usuário, o agente só opera. Combina perfeitamente: nós financiamos, a Drift delega operação |
| **x402** (Coinbase + Cloudflare, sob a Linux Foundation; membros incluem Google, Visa, AWS, Circle, Anthropic, Vercel) | ~75M tx/mês, majoritariamente sub-$1. Um adaptador x402 nos torna a camada de política embaixo do ecossistema inteiro |
| **Gate402 / Metera** | Cobra APIs via x402. Consumidor plausível do Agent Rails, não concorrente |
| **MCPay** (C4, 1º Stablecoins) e **Latinum** (1º AI, Breakout) | MCP-first, mas do lado de **cobrar**. Problema inverso |
| **Squads / Realms** | Nosso `owner` |

### 4.6 Saturação, medida

- The Grid: **138 produtos / 111 raízes distintas** em `ai_agent*` com tag Solana, excluindo descontinuados.
- 2.992 projetos nos hackathons Breakout + Cypherpunk. AI = 16,7% do Breakout; DeFi = 25,1% do Cypherpunk.
- Tags de problema mais frequentes: "information overload", "information asymmetry", "rug pulls". **"Gasto descontrolado de agente" não aparece no topo.**
- Portfólio de aceleradora: sem sobreposição direta.

**Leitura para a reunião:** muitos agentes, muitos executores, quase nenhum guardrail. Espaço livre — ou mercado que ainda não existe. §1, decisão aberta.

---

## 5. Posicionamento e frentes

### 5.1 A frase que define a categoria

> **Todo mundo está resolvendo como o agente paga. Nós resolvemos quanto ele pode perder — e provamos.**

### 5.2 O mapa de posicionamento

```
                    ENFORCEMENT OFF-CHAIN          ENFORCEMENT ON-CHAIN
                 ┌──────────────────────────┬──────────────────────────┐
  PAGAMENTO      │ Bido, Visa IC, Stripe    │ Solana Allowances        │
  (mover valor)  │ ACP, Nekuda, Skyfire,    │ Squads Spending Limits   │
                 │ Privy, Coinbase          │ Swig                     │
                 ├──────────────────────────┼──────────────────────────┤
  GOVERNANÇA     │ Mercantill               │                          │
  (quem pode     │ Brahma (EVM)             │   ►►► AGENT RAILS ◄◄◄    │
  quanto, e      │ Almanak, Giza (EVM)      │                          │
  prova disso)   │ Lit Vincent              │   (vazio na Solana)      │
                 └──────────────────────────┴──────────────────────────┘
```

### 5.3 Onde temos vantagem real

1. **A garantia é o programa, não um servidor.** Todo concorrente tem peça off-chain confiável no caminho. Checável com `solana program show`.
2. **Quatro papéis com poderes enumerados, afrouxamento só descendo.** Nenhum concorrente pesquisado separa dono/operador/guardião/sessão.
3. **Cadeia de hash por sessão** — prova de **não-omissão**, não só de não-alteração. Log off-chain prova que não editou; não prova que não apagou.
4. **Superfície MCP sem escalada de privilégio, testada** (`tool-surface.test.ts`).
5. **Rigor formal** que ninguém no nicho tem: `no_std`, Kani, 99,2%, pirâmide de 5 camadas.
6. **Hierarquia sem código novo** (§2). Nenhum concorrente — cartão ou cripto — mostra isso.

### 5.4 Onde **não** temos

- Limite de gasto simples (commoditizado pelo primitivo nativo, grátis).
- Execução DeFi (Brahma/Giza/Almanak, anos à frente).
- Alcance de lojista (Bido tem Gymshark; nós temos allowlist e exigimos USDC na Solana).
- Aprovação humana por compra (`approval_threshold` é v1.1 reservado).
- Distribuição. Eles têm token, comunidade e volume; nós temos um repo de 10 dias com CI verde.

### 5.5 O que nunca dizer

❌ "Mais um jeito de limitar gasto de agente" · ❌ "Trading seguro para agentes" · ❌ "Substitui o Squads" · ❌ TAM sem fonte

### 5.6 O que sempre dizer

✅ "A garantia é o programa, confira você mesmo" · ✅ "Afrouxar só flui morro abaixo" · ✅ "Apagar um pagamento do log é detectável" · ✅ "A superfície do agente não tem uma ferramenta que escale privilégio — e isso é um teste"

---

## 6. Estratégia de mercado

### 6.1 Quem é o primeiro usuário

| | **Dev solo / indie** | **Empresa rodando agentes** |
|---|---|---|
| Dor | "não quero dar minha chave para o Claude" | "não posso ter cinquenta agentes gastando sem trilha de auditoria" |
| Valor | segurança pessoal | conformidade, controladoria, limite de risco |
| Caminho | `npx agent-rails init`, MCP no Claude Desktop, devnet | piloto, integração, auditoria exigida |
| Paga? | não | sim, mas só pós-auditoria |
| Papel | **funil e prova social** | **receita** |

**Recomendação:** aquisição otimizada para o indie, narrativa para a empresa.

### 6.2 As três jogadas de distribuição, em ordem de retorno

1. **`npx agent-rails init`** — devnet, sobe tesouraria/política/allowlist/sessão, funda o cofre, escreve a config MCP. Meta: **< 5 min até o primeiro pagamento guardado** (ADR-009). **Não existe. É o item de maior alavancagem que resta.**
2. **Integração-demo com executor DeFi** — "financie um agente de trading da Drift com limite diário provado on-chain". Um fim de semana; responde a pergunta que o ecossistema faz; posiciona como complemento.
3. **Adaptadores de framework** (LangChain, Vercel AI SDK, OpenAI Agents) + PyPI + **adaptador x402**. Distribuição gratuita e permanente. O x402 é o de maior alcance estratégico: nos torna a camada de política embaixo daquele ecossistema.

### 6.3 x402 — a relação, explicada

Vale uma seção própria porque é a integração de maior alcance estratégico que temos, e porque é fácil confundir com concorrência.

**O que o x402 é.** Um padrão de pagamento sobre HTTP 402: o servidor responde `402` com `{ version, accepts: [{ scheme, network, amount, token, payTo }] }`, o cliente paga e repete a requisição com uma prova no header `X-Payment`. Governado pela x402 Foundation (Coinbase + Cloudflare, sob a Linux Foundation; entre os membros, Google, Visa, AWS, Circle, **Anthropic** e Vercel). Volume divulgado: **~75 milhões de transações e ~$24 mi em 30 dias, a maioria abaixo de $1**. A V2 formalizou tokens de sessão e suporte multi-chain.

**Por que é complemento e não concorrente.** As duas perguntas são ortogonais:

| | Pergunta que responde |
|---|---|
| **x402** | *Como* este agente paga por este recurso? |
| **Agent Rails** | *Este agente deveria poder pagar isso?* |

O x402 não tem teto, não tem janela, não tem allowlist de destino, não tem papéis, não tem trilha de auditoria. Ele assume que a carteira do agente pode pagar — que é exatamente a suposição que existimos para remover.

**O adaptador, tecnicamente.** Um `@agent-rails/adapters/x402` que intercepta o `402`, roteia o pagamento por `execute_payment` em vez de uma transferência crua, e devolve o header de prova. O payload do 402 é ~30 linhas de parsing; o resto é o `executePayment` que já existe. Cabe em `packages/adapters/*`, ao lado de langchain / ai-sdk / openai-agents.

**Por que é estratégico.** Ele nos torna a **camada de política embaixo do ecossistema x402 inteiro** — e converte um concorrente aparente (Gate402/Metera, que cobra APIs via x402) em consumidor: um agente pagando faturas x402 é precisamente a carga de trabalho que quer uma tesouraria limitada por política atrás dela. E o x402 gera a pior coisa que se pode fazer com uma carteira ilimitada: milhares de pagamentos autônomos e minúsculos, sem humano no circuito. Isso faz dele o nosso melhor funil.

**A fricção honesta, que precisa ser dita na reunião.** Todo pagamento nosso cria um `IntentReceipt` de **243 bytes**, com aluguel rent-exempt de **~0,0026 SOL**. Esse valor é **devolvido** pelo `close_receipt` após a expiração, mas precisa ser **adiantado pelo fee payer** e recuperado depois. Para um pagamento x402 de $0,01, o aluguel adiantado vale mais que o pagamento. Consequências:

- O adaptador x402 encaixa bem nos pagamentos x402 **de maior valor** (dezenas de centavos para cima), não nos sub-centavo.
- Quem rodar isso em volume **precisa** de fechamento automático de recibos — vira item obrigatório do indexer/CLI, não opcional.
- Micropagamento de verdade é caso para **Payment Channels** (Solana, set/2026) ou para agregação: liquidar em lote pelo Agent Rails e deixar o x402 individual fora do trilho. Isso é decisão de v1.1+, não de agora.

**Recomendação:** o adaptador x402 é item de v1.1, não dos 25 dias. Mas **mencioná-lo no pitch é barato e forte** — mostra que entendemos onde o ecossistema está indo e que nos posicionamos embaixo dele, não contra ele.

### 6.4 O que a arquitetura **fecha** — ler antes de propor qualquer modelo

| Decisão registrada | Modelos que ela mata |
|---|---|
| O dinheiro passa por uma PDA do cliente e nunca tocamos nele | Custódia, float, qualquer pedágio no caminho |
| Programa será congelado (upgrade authority → None) | Taxa de protocolo mutável — exigiria o super-owner que o congelamento existe para eliminar |
| Superfície do agente sem ferramenta de escalada | Upsell via agente ("agente pede aumento de limite e você cobra") |
| Guardião não despausa; saque do dono funciona pausado | "Pausamos sua tesouraria até você pagar" — estruturalmente impossível, e ainda bem |
| Apache-2.0 sem CLA | Open-core **dentro deste repo** |
| Sem serviço hospedado na v1 | Nada permanente; sequencia receita hospedada para depois da v1 |

**E um ativo que a arquitetura cria e ninguém mais tem:** todo cliente publica on-chain, em `long_window_max` e `lifetime_max`, **o máximo que aceita perder**, em USDC, legível por qualquer um. É uma métrica de precificação entregue pelo próprio modelo de dados. A §8 usa isso.

---

## 7. Modelos de negócio — as nove linhas

Ordenadas por (encaixe com a arquitetura) × (defensabilidade) ÷ (esforço).

### 7.1 ★★★ Guardian-as-a-Service — a mais forte

O cliente coloca sua pubkey num dos cinco slots de guardião. Você monitora o stream de eventos e chama `pause` quando algo parece errado: velocidade de gasto subindo em direção ao `short_window_max`, rajada de recusas, sessão pagando destino nunca visto, agente batendo no `per_tx_max` repetidamente, atividade fora do horário declarado.

**Por que é a melhor ideia do documento:** serviço de segurança tem um problema de confiança — para te proteger preciso de acesso, e acesso é risco. O programa já resolveu isso. Um guardião pode chamar exatamente uma instrução, não pode despausar, não pode sacar, não pode configurar, e pode ser removido pelo dono unilateralmente. **O pior que um guardião totalmente comprometido faz é desligar o agente do cliente** — e isso é checável on-chain em dez segundos, não afirmado num PDF de trust center.

**Riscos:** (a) falso positivo é outage de produção do cliente — o SLA tem de ser sobre **detecção**, nunca sobre "não vamos pausar errado"; modo dry-run como padrão. (b) guardião afobado é vetor de DoS; auto-rate-limit. (c) você segura uma chave quente de verdade.

**Esforço:** moderado, e reaproveita trabalho que já devemos (indexer + `verifyChain` + alertas).

### 7.2 ★★★ Indexer hospedado + console

Publique o `@agent-rails/indexer` em Apache-2.0 e venda o hospedado: ingestão gerenciada, retenção além do que gPA responde, `verifyChain`, `list_payments`/`get_payment_status` para a MCP, console read-only, alertas, export.

**Encaixa porque:** custo marginal real (Yellowstone/retenção é caro de verdade → preço defensável, não rent-seeking); zero risco de custódia (lê dado público); e o caminho grátis continua honesto — `list_payments` degrada para "unavailable" por design.

**Por que é a segunda e não a primeira:** é mais próximo de commodity. Helius e Triton vendem indexação; nossa diferenciação é entender `AgentRailsEvent` e rodar `verifyChain`.

**Nota de sequenciamento:** construa o core **uma vez**, Apache-2.0. Ele é o substrato de 7.1, 7.2 e 7.3.

### 7.3 ★★★ Controladoria de organização de agentes *(linha nova, criada pela §2)*

Com `reference` obrigatória em todo pagamento e a árvore de tesourarias, o indexer produz: custo por agente, por cargo, por departamento; rastreio até id de tarefa; alocação vs. retorno por agente de trading; consolidado da empresa. **FinOps para organizações de agentes.** O dado é gerado pelo programa sem esforço adicional, e vende para o mesmo comprador de 7.4.

### 7.4 ★★ Atestações de conformidade e auditoria

Transformar `audit_head` num artefato que o financeiro paga: relatório periódico, assinado, verificável de forma independente, de que *todo pagamento deste agente no trimestre esteve dentro da política declarada, e aqui está a cadeia provando que nenhum foi omitido*.

**Só nós podemos vender:** concorrente com log off-chain prova que não editou; não prova que não apagou. Essa distinção é o valor inteiro de um artefato de auditoria.

**Comprador:** não é o dev. É risco/compliance — orçamento diferente, disposição a pagar muito maior, renovação no calendário de auditoria. **Dê o verificador de graça:** é ele que torna a atestação vendável.

**Pré-requisito:** só vende para empresa grande o bastante para ter função de auditoria. Projete agora, venda no ano 2.

### 7.5 ★★ Track record verificável de agente *(linha nova)*

A cadeia de uma sessão de trading é uma curva de alocação com selo temporal; somada ao saldo devolvido ao cofre, é um P&L verificável por terceiro sem confiar em quem publica. Matéria-prima de **reputação de agentes** — para marketplaces (Virtuals ACP, Olas), para quem aloca capital em estratégias de agente, e como camada de descoberta.

**Risco:** mercado de dois lados, depende de adoção prévia. Anotar, não construir.

### 7.6 ★★ Pacotes de política e feeds de screening

A interface `PolicyHook` é um ponto de extensão vazio. Encha com **dado mantido**: endereços sancionados e de drainers, classificação de risco de mint (honeypot, freeze authority viva, extensões surpresa), pacotes Cedar/OPA prontos (só horário comercial, orçamento por fornecedor, pagamento casado com nota).

Interface grátis, feed por assinatura — padrão Snyk/Semgrep/ClamAV, e **sobrevive a fork**: o fork leva o código, não as atualizações.

**Obrigatório na doc:** política soft **não é** a garantia, e o resultado precisa ter quatro estados (`match` / `possible` / `no_match` / **`unavailable`**) para que queda do feed nunca leia como "permitido".

### 7.7 ★ Relayer (v1.1)

No modo signed-intent o agente assina off-chain e um relayer submete `[Ed25519Program.verify, execute_payment]`. O `fee_payer` já é conta separada da `session_key` exatamente para isso. Cobre gas + margem, por transação. Pequeno, custo unitário óbvio, e ninguém mais vai construir um que entenda `PaymentIntent`.

**Pule o managed signing.** Turnkey, Privy, Dfns e Fireblocks já vendem isso, e a arquitetura deliberadamente faz qualquer signer compatível com Kit funcionar sem cola.

### 7.8 ★★★ Grants — a jogada correta **agora**

Não-dilutivo, não exige clientes nem infraestrutura, e **financia a auditoria, que é pré-condição de 7.1–7.6**. Ninguém coloca tesouraria real atrás de programa não auditado.

O trabalho já tem formato de grant: bem público, Apache-2.0, na Solana, com histórico de ADRs e pirâmide de testes que quase nenhum candidato mostra. **Superteam Brasil** é o caminho natural.

**O que faz a candidatura forte, em ordem:** deploy em devnet funcionando · o conjunto de ADRs (o diferencial — quase nenhum candidato tem 15 aceitas) · a pirâmide de testes · firma de auditoria nomeada com orçamento · declaração clara de que o programa será congelado e sem taxa.

### 7.9 ★ Enterprise: integração, adaptadores, suporte

Margem alta, caixa imediato, zero infraestrutura — e não escala além das horas do time. Aceite só o que produzir cliente de referência ou adaptador reutilizável. Um **design partner** (integração com desconto em troca de estudo de caso público e feedback detalhado) costuma valer mais que o honorário nesta fase.

### 7.10 O que não funciona

| Ideia | Por quê |
|---|---|
| Taxa de protocolo no `execute_payment` (v1) | Irreconciliável com a imutabilidade; removível em uma linha num fork; taxa adoção inexistente |
| Custódia / float | Destrói a única alegação diferenciadora. Erro de categoria |
| Token | Sem sink: sem taxa para distribuir, sem papel de staking que o guardião não preencha melhor, sem governança após o congelamento. Passivo regulatório num produto cujo pitch é "verifique você mesmo" |
| Gatear MCP ou SDK | A superfície do agente é a superfície de adoção |
| Cobrar pelo verificador da cadeia | Atestação não verificável vale menos, não mais |
| Reter fundos por inadimplência | Estruturalmente impossível — saque do dono sempre funciona |
| Open-core dentro deste repo | Apache-2.0 sem CLA. Repositório separado, decidido antes do primeiro PR externo |
| Construir execução DeFi | Reescrita, modelo de ameaça diferente, três anos atrás dos incumbentes |

### 7.11 Aquisição — vale dizer em voz alta

O desfecho grande mais provável para um primitivo não-custodial de controle de gasto de agente é **aquisição por um adjacente** — Squads, Turnkey, Privy, Dfns, uma carteira, uma plataforma de tesouraria. Todos têm clientes perguntando "como deixo um agente gastar sem entregar as chaves" e nenhum tem resposta limpa. O que aumenta esse valor **não é receita**: é adoção, auditoria, programa congelado e proveniência Apache-2.0 sem ambiguidade — a mesma lista de sempre. Otimize o produto; a opção vem de graça.

---

## 8. Precificação

> **Aviso para a reunião:** nada disso é vendável antes da auditoria. Os números abaixo são para decidir *forma* de cobrança e ordem de grandeza, não para publicar amanhã.

### 8.1 Âncoras de mercado, verificadas hoje

| Produto | Preço público | Fonte |
|---|---|---|
| **Squads** | $0 Basic (taxa única 0,1 SOL) · **$49/mês Pro** · Enterprise sob consulta | [docs.squads.so](https://docs.squads.so/main/getting-started/pricing) |
| **Helius** (RPC + indexação Solana) | $0 · **$49** · **$499** · **$999**/mês; add-ons de dados $500–$4.500/mês | [helius.dev/pricing](https://www.helius.dev/pricing) |
| **Privy** (infra de carteira) | Free · **$299** · **$499**/mês · Enterprise | [privy.io/pricing](https://www.privy.io/pricing) |
| **Turnkey** (assinatura) | **$0,10/assinatura** PAYG (≤1.000 wallets) · **$99/mês** Pro a $0,05/assinatura · Enterprise a $0,0015 | [openfort](https://www.openfort.io/blog/privy-vs-turnkey) |
| **Gate402 / Metera** (adjacente) | $0 · $29 · $99/mês · custom | pesquisa anterior |
| **Chainalysis** (compliance) | **€120k–€250k/ano** para CASP médio; implementação $5k–$25k | [finconduit](https://finconduit.com/resources/blockchain-analytics-providers-compared) |
| **Hypernative** (monitoramento de segurança) | sem preço público — enterprise sob consulta. $40M Série B, 200+ clientes, $100 bi protegidos | [hypernative.io](https://www.hypernative.io/products/hypernative-platform) |

**O que essas âncoras dizem:** infraestrutura Solana para dev vive em **$49–$999/mês**; segurança e compliance de verdade vivem em **cinco a seis dígitos por ano**; e cobrança por operação é aceita na casa de **centavos**.

### 8.2 Guardian-as-a-Service

**Métrica de cobrança: teto agregado protegido** — o `long_window_max` somado dos mints configurados. O cliente já publicou esse número on-chain; é a declaração dele do máximo que aceita perder.

| Plano | Preço | Teto protegido | Inclui |
|---|---|---|---|
| **Watch** | **$0** | 1 tesouraria, qualquer teto | Modo dry-run (alerta, nunca pausa), alertas por webhook, sem SLA |
| **Guard** | **$149/mês** | até **$10k/dia** | Pause armado, regras padrão, SLA de **detecção** 15 min, 1 chave de guardião |
| **Guard Pro** | **$599/mês** | até **$100k/dia** | Regras customizadas, SLA de detecção 5 min, chave por ambiente, runbook de incidente |
| **Guard Scale** | **$1.999/mês** | até **$1M/dia** | SLA 1 min, RPC privado, on-call, revisão trimestral de política |
| **Enterprise** | sob consulta | acima de $1M/dia | Multi-entidade, contrato, suporte dedicado |

**Justificativa:** $599/mês sobre um teto de $100k/dia = **$7.188/ano contra uma perda máxima declarada de $100k em um único dia**. É ~7% de um dia de exposição, por ano inteiro. Contra Hypernative (enterprise, cinco dígitos) somos a opção acessível; contra Helius Business ($499) estamos na mesma faixa de "infra séria para produção".

**O que jamais prometer no SLA:** que não vamos pausar errado. O SLA é de detecção. Dry-run é o padrão.

### 8.3 Indexer hospedado + console

| Plano | Preço | Inclui |
|---|---|---|
| **Free** | **$0** | 1 tesouraria, 7 dias de retenção, `verifyChain` sob demanda, console read-only |
| **Team** | **$149/mês** | 5 tesourarias, 90 dias, alertas, export CSV/JSON, `list_payments` na MCP |
| **Business** | **$599/mês** | Tesourarias ilimitadas, 12 meses, webhooks, SSO, múltiplos usuários |
| **Enterprise** | sob consulta (referência: **$1.500–$4.000/mês**) | Retenção multi-ano, Postgres dedicado, VPC, SLA de ingestão |

**Base de custo a checar antes de publicar:** um plano Helius Business ($499) ou Professional ($999) + add-on de dados serve **vários** clientes. Com Team a $149, a margem bruta fecha a partir de ~5 clientes pagantes. **Validar isso com números reais antes de comprometer preço.**

### 8.4 Controladoria de agentes

Cobrar por **sessão de agente ativa** — a unidade que o cliente entende e que cresce com o valor entregue.

| Plano | Preço | Inclui |
|---|---|---|
| **Free** | **$0** | até 3 sessões ativas, relatório mensal básico |
| **Team** | **$9/agente/mês** (mínimo $49) | Custo por agente/cargo/departamento, rastreio por `reference`, export |
| **Business** | **$599/mês** | Agentes ilimitados, consolidação multi-tesouraria, centro de custo, export contábil, API |
| **Enterprise** | sob consulta | Múltiplas entidades, integração com ERP, campos customizados |

**Justificativa:** $9/agente é preço de assento de SaaS, familiar para quem aprova orçamento. Uma organização com 50 agentes cai em $450/mês, que é onde o plano Business ($599) passa a fazer sentido — a escada funciona sozinha.

### 8.5 Bundle — o produto que realmente queremos vender

| **Treasury Assurance** | **$999/mês** |
|---|---|
| Guardian Pro (até $100k/dia) + Indexer Business + Controladoria ilimitada | Desconto de ~30% sobre os três avulsos ($1.797) |

Um preço, um contrato, um comprador. É a oferta que se apresenta primeiro; os planos avulsos existem para quem quer só uma peça.

### 8.6 Atestações de conformidade

| Formato | Preço |
|---|---|
| Atestação trimestral, 1 tesouraria | **$2.500/trimestre** ou **$8.000/ano** |
| Multi-entidade, formato exigido pelo auditor, suporte a due diligence | **$25.000–$60.000/ano** |
| Onboarding / integração inicial | **$5.000–$15.000**, uma vez |

**Justificativa:** Chainalysis a €120k–250k/ano é o teto desse orçamento; entregamos um artefato estreito e específico, então 5–20% daquilo. O onboarding espelha a faixa de implementação deles ($5k–$25k). O verificador é **gratuito e open-source** — é o que torna a atestação crível.

### 8.7 Relayer

**$0,002 por transação patrocinada**, com piso de **$49/mês**. Custo real na Solana é fração de centavo; a margem está na conveniência e no patrocínio de gas.
**Âncora:** Turnkey cobra $0,05–$0,10 por assinatura. Cobrar $0,002 por transação é uma ordem de grandeza abaixo e ainda assim lucrativo — e a comparação é uma boa frase de vendas.

### 8.8 Feeds de política e screening

| Plano | Preço |
|---|---|
| **Basic** — endereços sancionados + drainers, atualização diária | **$199/mês** |
| **Pro** — + risco de mint, pacotes Cedar/OPA, histórico, SLA de atualização | **$499/mês** |
| Enterprise — listas próprias, on-prem | sob consulta |

### 8.9 Serviços

| | |
|---|---|
| **Design partner** (integração + estudo de caso público) | **$5.000–$15.000**, ou grátis em troca do caso, feedback e referência |
| **Retainer de integração** | **$3.000–$8.000/mês**, com teto de horas |
| **Revisão de design de política** | **$2.500** por engajamento |

### 8.10 Checagem de realidade para a reunião

Com **Treasury Assurance a $999/mês**:

| Clientes | MRR | ARR | Significa |
|---|---|---|---|
| 5 | $5.000 | $60.000 | Paga a infraestrutura e um pouco mais |
| 10 | $10.000 | $120.000 | Sustenta uma pessoa em tempo integral |
| 25 | $25.000 | $300.000 | Sustenta um time pequeno |
| 50 | $50.000 | $600.000 | Conversa com investidor muda de tom |

**A pergunta certa para a reunião não é qual preço cobrar. É: existem 10 empresas hoje, alcançáveis por nós, que rodam agentes com dinheiro suficiente para pagar $999/mês?** Se ninguém souber responder, a Semana 3 da §11 (as cinco conversas) é a tarefa mais importante do plano inteiro.

---

## 9. As trilhas do hackathon

Prêmio total ~**$840.000** + **$2,5M** em capital semente ($250k por equipe aceita na aceleradora). Submissão até **12/10/2026**.

| Trilha | Prêmio | Encaixe | Argumento |
|---|---|---|---|
| **Solana Ecosystem** | **$100k — 10 × $10k** | ★★★ **principal** | Programa Anchor nativo, CPI só em SPL Token/Token-2022/ATA/System, integra com o Allowances nativo (ADR-014), cliente Codama |
| **Top 20** | **$300k — 20 × $15k** | ★★★ | A faixa mais provável. Não exige ser o melhor; exige ser claramente bom |
| **Grand Prize** | **$30k** | ★★ | Rigor de engenharia raro + categoria nova |
| **Public Good** | **$5k** | ★★★ | **Melhor relação esforço/retorno.** Apache-2.0, programa a ser congelado com upgrade authority renunciada, sem taxa de protocolo por decisão em ADR, verificador de auditoria gratuito, 15 ADRs públicas. Aqui o argumento não é retórico |
| University | $5k | — | Só com vínculo universitário; verificar elegibilidade |
| Ethereum (~$100k, ~$25k por sub-trilha) | $100k | ✗ | EVM. Port em 25 dias destrói a história de qualidade |
| Tempo | ~$100k | ✗ *(anotar)* | L1 de pagamentos em stablecoin — tese adjacente. Melhor candidato a segundo ecossistema no futuro |
| Hyperliquid | $100k — top 10 | ✗ *(anotar)* | HyperCore/HyperEVM. O modelo de alocação é tese perfeita para esse público |
| Base / Arbitrum / Zcash / Robinhood Chain | — | ✗ | Fora de escopo |

**Jogada:** uma submissão, **Solana como trilha declarada, mirando Top 20, com Public Good como segundo tiro barato.**

> **Verificar no formulário antes de submeter:** (a) se uma submissão pode concorrer à trilha de ecossistema **e** ao Public Good simultaneamente; (b) as regras desta edição sobre projeto pré-existente — as regras padrão da Colosseum que consultei (Renaissance 2024) não proíbem e a prática histórica aceita projetos em andamento, mas o documento desta edição não foi lido.

---

## 10. Critérios de julgamento e onde investir

Os seis critérios oficiais (forma padrão Colosseum):

| Critério | Nossa posição | O que fazer |
|---|---|---|
| **(a) Functionality** — funciona? qualidade do código? | **Muito forte.** 161 testes Rust, Kani, 99,2%, CI com 11 checks | Nada a construir. **Tornar visível**: badge de CI, números no README, comando da demo no topo |
| **(b) Potential Impact** — mercado, impacto no ecossistema | **Médio, mal contado.** Temos dados reais (x402 ~75M tx/mês; Visa a $7 bi de run-rate; Olas 9M+ tx) e não os usamos | Um parágrafo **com fontes**, não pirâmide de TAM |
| **(c) Novelty** | **Forte, se enquadrado certo.** "Limite de gasto" não é novo; "organograma de agentes com prova de não-omissão" é | Liderar com o organograma |
| **(d) UX** — usa a performance da Solana para boa UX | **Fraco.** Sem CLI, sem onboarding, setup manual | **Maior lacuna.** `npx agent-rails init` + vídeo de 2 min |
| **(e) Open-source** — aberto? compõe? | **Muito forte.** Apache-2.0, IDL versionada, cliente gerado, integra com Allowances nativo, `owner` pode ser PDA do Squads | Dizer explicitamente **com o que compõe** |
| **(f) Business Plan** | **Forte no papel, invisível na submissão.** A §7 e a §8 existem e ninguém sabe | Três frases: guardião → indexer → controladoria, com o porquê de não haver taxa |

**Somos fortíssimos em (a) e (e), competitivos em (c) e (f), fracos em (d), subestimados em (b). Todo o esforço restante vai para (d) e para tornar (a), (e) e (f) legíveis — não para escrever mais programa.**

---

## 11. Cronograma — 25 dias até a submissão

**Marcos fixos — estas datas não se movem:**

| Data | Marco | Se falhar |
|---|---|---|
| **17/09 (qui)** | Reunião de time: as seis decisões da §1 saem fechadas | A Semana 1 começa no escuro e a decisão #2 fica irreversível por omissão |
| **23/09 (qua)** | **Gate 1 — instalável.** Alguém de fora faz um pagamento guardado em devnet em < 5 min | A Semana 2 começa consertando o CLI, não gravando vídeo |
| **30/09 (qua)** | **Gate 2 — demonstrável.** Vídeo de 2 min gravado, organograma vivo em devnet | Corta-se a página de comparação para recuperar |
| **07/10 (qua)** | **Gate 3 — defensável.** Narrativa completa e ≥3 das 5 conversas feitas | As conversas passam na frente do deck |
| **09/10 (sex)** | **Submeter** — três dias antes do prazo, de propósito | Resta a reserva, que é para acidente, não para atraso |
| **12/10 (seg)** | Prazo oficial da Colosseum | Fim |

### Semana 1 (17–23/09) — de repositório a produto instalável

Ataca o critério **(d) UX**, o mais fraco da §10 e 1/6 da nota.

| Dia | Entrega | Pronto quando |
|---|---|---|
| 17/09 qui | Decisões da §1 registradas — ADR-016 para a taxa de protocolo se a decisão #3 sair | Nenhuma das seis termina em "depois" |
| 18/09 sex | `agent-rails init`, esqueleto: keypair, airdrop, tesouraria, política de exemplo | Roda ponta a ponta numa máquina limpa |
| 19–20/09 | Deploy em devnet, endereço no README; `init` escreve a config MCP | Claude Desktop enxerga as ferramentas sem editar JSON à mão |
| 21/09 seg | README reescrito: organograma no topo, números da §3.5, badge de CI, comando da demo na primeira tela | Um leitor entende o que é em 30 segundos |
| 22/09 ter | Quickstart de 5 min em `docs/`, `--devnet` documentado | Um terceiro segue sem perguntar nada |
| 23/09 qua | **Gate 1**, cronometrado, feito por quem não escreveu o código | < 5 min do `npx` ao primeiro pagamento recusado por limite |

### Semana 2 (24–30/09) — a demonstração

Ataca **(c) Novelty** e fecha **(d)**.

| Dia | Entrega | Pronto quando |
|---|---|---|
| 24–25/09 | O organograma da §2 em devnet pelo SDK — a mesma árvore, fora do LiteSVM | Assinaturas públicas, verificáveis por qualquer jurado |
| 26/09 sáb | Roteiro do vídeo, escrito e cronometrado **antes** de gravar | A recusa por limite aparece antes do minuto 1 |
| 28/09 seg | Gravação: Claude Desktop → `check_payment` → `execute_payment` → recusa → `get_session` com o contador | Uma tomada, sem corte esperto |
| 29/09 ter | Página de comparação honesta: Allowances nativo · Squads · cartão virtual · Agent Rails | Diz o que cada um faz **melhor** que nós |
| 30/09 qua | **Gate 2** | Vídeo publicado (não listado) e linkado no README |

### Semana 3 (01–07/10) — narrativa e validação

A semana de maior risco: é a única que depende de pessoas de fora.

| Dia | Entrega | Pronto quando |
|---|---|---|
| 01–02/10 | `THREAT_MODEL.md`, `SECURITY.md`, `GOVERNANCE.md` | Existem — hoje nenhum existe, e são pré-requisito de grant e de auditoria |
| **todo dia, 01–07/10** | **As cinco conversas com quem já roda agente com dinheiro** — 2 marcadas até 02/10, 5 feitas até 07/10 | Ao menos uma citação literal utilizável no deck |
| 05/10 seg | Post técnico *"Um organograma feito de contas"* | Publicado, não em rascunho |
| 06/10 ter | §7 e §8 reduzidas a três frases para o formulário | Guardião → indexer → controladoria, com o porquê de não haver taxa |
| 07/10 qua | **Gate 3** | Se as conversas não aconteceram, elas passam na frente de tudo na Semana 4 |

### Semana 4 (08–12/10) — submissão

| Dia | Entrega | Pronto quando |
|---|---|---|
| 08/10 qui | Deck de 10 slides, montado a partir da §3 — slide 1 é o organograma, nunca o limite de gasto | Cabe em 3 min falados |
| 09/10 sex | **Submeter.** Formulário + as duas verificações da §9 (trilha dupla; projeto pré-existente) | Recibo salvo no repo |
| 10–12/10 | Reserva. Só correções | Nada novo entra |

### Caminho crítico e regras de corte

**Caminho crítico:** CLI (18–20/09) → vídeo (28/09) → deck (08/10). O resto tem folga; esses três não. Atraso no CLI empurra o vídeo e come a reserva de 10–12/10.

**Regra de corte:** se na sexta o gate da quarta seguinte parecer inalcançável, **corta-se o escopo do gate, nunca a data**. As únicas datas que o mundo externo conhece são 09/10 e 12/10.

**Dependência humana ainda aberta:** decisão #6 da §1 — horas reais por pessoa. Este cronograma assume o equivalente a **uma pessoa em tempo integral**. Com metade disso, cortam-se a página de comparação (29/09), o post técnico (05/10) e os documentos de governança; **não** se cortam CLI, vídeo, conversas e deck.

**O que NÃO fazer nesses 25 dias:** CPI para protocolos DeFi · pause em cascata · dashboard hospedado · port para outro ecossistema · indexer completo · qualquer preço publicado.

---

## 12. Decisões irreversíveis com prazo

| Decisão | Prazo real | Por quê |
|---|---|---|
| **Taxa de protocolo: sim ou não** | **Data da auditoria/congelamento** | Depois do freeze, adicionar taxa exige programa 2.x e `migrate_treasury` em toda a base instalada. Ninguém migra para ser taxado |
| **Repositório comercial separado** | **Antes do primeiro PR externo** | Apache-2.0 sem CLA: no instante em que a contribuição de um terceiro entra, relicenciar fica impossível |
| **Aceitar contribuições externas** | Quando abrirmos | Ativa o prazo acima |
| **Linha divisória do que é aberto** | Junto com a decisão #2 | Regra proposta: *se pode recusar um pagamento, é Apache-2.0*. Nada proprietário no caminho de pagamento ou de enforcement |

---

## 13. Riscos

| Risco | Mitigação |
|---|---|
| **O comprador pode não existir ainda** — "gasto descontrolado de agente" não aparece entre as dores frequentes do corpus | As cinco conversas da Semana 3. Descobrir agora é barato |
| **Commoditização pelo protocolo** — se o Allowances nativo ganhar multi-limite ou allowlist | Acompanhar o roadmap; defesa é a camada de governança e a auditoria |
| **Jurado confunde com "mais um limite de gasto"** | Organograma lidera o pitch. Se a primeira frase for sobre limite, perdemos |
| **UX é o critério mais fraco e vale 1/6 da nota** | Semana 1 inteira |
| **Preço sem base de custo** (§8.3) | Medir o custo real de ingestão antes de publicar qualquer número |
| **Regras de elegibilidade** | Confirmar no documento oficial desta edição antes de submeter |
| **Sobrecarga do time** | Decisão #6 da §1. Planejar contra horas reais |

---

## 14. A frase para terminar qualquer conversa

> Você não precisa confiar em nós. O programa vai ser congelado, é Apache-2.0, e a garantia inteira está em código que você lê numa tarde e verifica com um comando. É esse o ponto.
