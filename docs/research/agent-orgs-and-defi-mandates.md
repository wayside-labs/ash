# Agent Rails — Organizações de Agentes, Mandatos DeFi e Modelos de Negócio

**Data:** 2026-09-16
**Estado do repo:** `ci/kani-policy-proofs` @ `0256a27` · programa com 23 instruções · política provada com Kani · SDK/MCP funcionais · sem auditoria, devnet
**Fontes:** código do programa (`programs/agent_rails/src/`), `ARCHITECTURE.md`, Colosseum Copilot (busca de projetos, arquivos cripto, análise de hackathon, The Grid), busca web
**Pesquisa anterior que este documento estende:** `colosseum-copilot-competitive-landscape.md`, `revenue-model-analysis.md`, `gate402-comparison.md`

> **Nota sobre projetos de hackathon:** a maioria não vira empresa. Os projetos citados aqui servem como inspiração e como registro do que já foi tentado — não como prova de que o espaço está tomado. Vários podem já estar inativos; confirme o estado atual antes de tirar conclusões competitivas.

---

## 0. Resposta curta

**Sim para a empresa. Não (ainda) para o trading.**

Uma organização de agentes — departamentos, leads, sub-agentes, orçamento por agente, auditoria por área — **já é expressável no que está construído hoje**, sem uma linha nova de programa. A descoberta técnica central deste documento está na §2.2: o `destination_owner` é um `UncheckedAccount` e o vault de uma treasury é a ATA comum dessa treasury, logo **uma treasury pode pagar outra treasury** e o dinheiro cai exatamente no cofre da filha. Isso te dá o organograma como estrutura de contas, com teto próprio, política própria e cadeia de auditoria própria em cada nível.

Agentes que emprestam na Kamino, abrem margem na Drift, entram em pool de liquidez ou compram token no dia do lançamento **não cabem no programa atual** — e a extensão não é barata, é um produto diferente com um modelo de ameaça diferente (§3). Mas existe um caminho composicional que funciona hoje e que provavelmente é o certo: Agent Rails **não governa a operação, governa a alocação de capital**. É o modelo de mesa proprietária — a mesa recebe um limite de capital, não uma permissão de operar. Essa reformulação está na §3.3 e é, na minha leitura, a ideia mais valiosa deste documento.

Sobre vantagem competitiva: ela existe, mas não está onde você talvez pense. Não está em "limitar gasto" (commoditizado — Solana tem primitivo nativo) nem em "executar DeFi com segurança" (Brahma, Almanak e Giza estão anos à frente, com bilhões em volume, em EVM). Está na interseção que ninguém ocupou: **a camada de governança e contabilidade verificável de uma organização de agentes** — papéis separados, afrouxamento que só desce, e uma cadeia de hash que prova que nenhum pagamento foi omitido. §5 detalha.

---

## 1. O modelo de contas, explicado

### 1.1 As cinco contas

Tudo no Agent Rails é PDA. Nenhuma chave privada controla fundos — o cofre é controlado por um programa, e o programa só se move quando todas as regras valem.

| Conta | Quem escreve | O que guarda | Seeds |
|---|---|---|---|
| **`Treasury`** | owner | papéis (owner, operator, até 5 guardians), `paused`, até 4 `MintConfig` (mint, token program, decimals, **ceiling**), campos reservados p/ v1.1 (`timelock_seconds`, `recovery_destination`) | `["treasury", owner, id]` |
| **`Policy`** | operator | nome, até 4 `MintLimit` (per-tx / janela curta / janela longa / vitalício), `destination_mode` (`Any` \| `Allowlist`), `create_destination_ata` | `["policy", treasury, name]` |
| **`AllowlistEntry`** | operator | `destination_owner`, `label`, `per_tx_max_override` | `["allowlist", policy, destination_owner]` |
| **`AgentSession`** | **só o programa** | `session_key`, `auth_mode`, `expires_at`, `revoked`, `seq`, `audit_head`, 4 `SpendCounter` | `["session", policy, session_key]` |
| **`IntentReceipt`** | **só o programa** | `intent_id`, `amount`, `seq`, `expires_at`, `fee_payer` | `["receipt", session, intent_id]` |

Mais dois cofres, que não são contas do programa: **`vault ATA`** (uma ATA comum por mint, cuja *authority* é a própria `Treasury` PDA) e **`sol_vault`** (PDA do System program, com piso rent-exempt intocável).

### 1.2 As decisões de modelagem e o que cada uma compra

**A Treasury é a própria autoridade do cofre.** Não existe uma "authority PDA" separada. Isso é menos uma economia de conta e mais uma propriedade: o endereço do cofre é `ATA(treasury_pda, mint)`, derivável por qualquer um, sem estado extra. Volta a importar na §2.2.

**Regras e estado moram separados.** `Policy` é o que o operador escreve; `AgentSession` é o que só o programa escreve. Consequência prática: **N sessões podem compartilhar uma política sem compartilhar orçamento**. Dez agentes na mesma política "compras até $200/dia" têm dez contadores independentes — a política é o cargo, a sessão é a pessoa. É exatamente a semântica que uma organização precisa, e caiu de graça da separação.

**Allowlist ilimitada com checagem O(1).** Um `AllowlistEntry` por *carteira de destino*, verificado por seeds — não há vetor a percorrer, então o número de destinos não custa CU nem tamanho de conta. E o programa **deriva a ATA de destino sozinho** (`execute_payment.rs:176`), o que significa que um agente não consegue ser apontado para uma conta de token sósia: ele escolhe um *dono*, nunca uma conta.

**Idempotência por construção.** O `IntentReceipt` é `init`-ado em `["receipt", session, intent_id]` — um `intent_id` repetido morre na criação da conta, antes de qualquer transferência. E o `intent_id` é *derivado* do pagamento (`sha256` de sessão ‖ destino ‖ mint ‖ valor ‖ referência), nunca sorteado, então um retry do mesmo pagamento lógico colide por construção. Recibo é fechável por qualquer um após a expiração e o aluguel volta para quem pagou.

**Contas versionadas e com padding.** Todo mundo carrega `version: u8` e um bloco reservado, e `tests/layout.rs` tira snapshot dos bytes. É isso que deixa a v1.1 entrar sem migração — e é o que torna viável, mais adiante, acrescentar campos de organização (§2.4) sem re-onboarding.

### 1.3 A ordem parcial que sustenta tudo

```
Owner  ──set_ceiling──►  MintConfig.ceiling
                              │  (update_policy exige Policy ≤ Ceiling)
Operator ──create_policy──►  Policy.mint_limits
                              │  (execute_payment exige gasto ≤ Policy)
Agente ─────────────────►  nada. O agente não escreve configuração.
```

A comparação `Policy ≤ Ceiling` é por slot de mint: os quatro máximos têm de ser `≤`, e as **durações de janela têm de ser `≥`** (janela maior com o mesmo teto é mais apertada — é a única linha da ordem parcial que inverte, e é exatamente a que as provas Kani cobrem). Modo `Any` de destino e criação de ATA só passam se o teto permitir.

Guardian é o papel mais interessante do modelo: ele pode chamar **uma** instrução, `pause`, e não pode despausar. É um papel que só sabe apertar. Ele existe porque quem detecta anomalia (bot, monitoramento, terceiro) não é quem deveria ter poder de destravar.

---

## 2. Uma empresa de agentes cabe nisso?

### 2.1 O que a pergunta realmente quer dizer

"Empresa de agentes" costuma misturar quatro coisas que têm dificuldades muito diferentes:

1. **Organograma** — quem responde a quem, quem pode o quê.
2. **Orçamento** — quanto cada um pode gastar, em que janela, para quem.
3. **Contabilidade** — quem gastou o quê, com prova.
4. **Operação** — o trabalho em si (pesquisa, negociação, trading, execução).

Agent Rails resolve (1), (2) e (3) de forma inusitadamente direta. Não resolve (4) e, na minha leitura, **não deveria tentar** — a §3 explica por quê.

### 2.2 A descoberta: hierarquia já funciona hoje

Em `execute_payment.rs:78-81`, `destination_owner` é um `UncheckedAccount` — o programa nunca lê nem escreve essa conta, só a usa para derivar a ATA de destino. Não há restrição de que seja uma conta de sistema, nem de que esteja na curva. E em `add_mint.rs:188`, o vault de uma treasury é criado como `ATA(treasury_pda, mint)` via `create_idempotent`, ou seja, uma ATA cuja autoridade é uma PDA — isso já funciona e está em produção no caminho principal.

Juntando as duas coisas: **se você cadastrar a `Treasury` PDA de uma treasury-filha como `destination_owner` em um `AllowlistEntry`, um pagamento do pai cai exatamente no cofre da filha.** A ATA já existe (foi criada no `add_mint` da filha), então nem o caminho de criação de ATA é acionado.

Isso te dá o organograma de graça:

```
                    Treasury RAIZ (owner = cold key / Squads)
                    ceiling: $50k/dia
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
   Treasury PESQUISA  Treasury OPS     Treasury TRADING
   ceiling $2k/dia    ceiling $10k/dia  ceiling $20k/dia
          │                 │                 │
    Policy "analista"  Policy "compras"  Policy "alocação"
    per-tx $50         per-tx $500        per-tx $5k
    dia    $300        dia    $3k         dia    $15k
          │                 │                 │
   ┌──────┼──────┐     ┌────┴────┐        ┌───┴───┐
  ses1   ses2   ses3  ses4     ses5      ses6   ses7
  (cada sessão = um agente, com contador e cadeia de auditoria próprios)
```

Cada seta para baixo é um pagamento de verdade, gravado na cadeia de hash do pai. Cada caixa tem seu próprio teto, sua própria política, seu próprio kill switch e sua própria trilha de auditoria. E a propriedade que você mais quer numa organização vale em cada nível: **afrouxar só desce**. Um lead não consegue se dar mais orçamento; o teto dele foi escrito pelo nível acima.

Observações que importam:

- **O "lead" é um papel de operador, não um agente.** Se você quiser que um agente-lead redistribua orçamento entre sub-agentes, esse agente precisaria da chave de operador — e aí a garantia inteira cai, porque operador cria e revoga sessões. **Não faça isso.** O lead redistribui *dinheiro* (pagando a treasury do sub-agente), não *limites*. Essa distinção é a mesma que a `CLAUDE.md` chama de invariante e vale a pena repetir: mover valor é do agente; mover limite nunca é.
- **Custo:** cada nível é um salto a mais. Um pagamento raiz → departamento → agente → fornecedor são três `execute_payment`, três recibos, três aluguéis. Para um organograma de 3 níveis isso é irrelevante; para 6 níveis com micropagamentos vira caro.
- **Sub-orçamento com rollover é a semântica errada para repasse.** As janelas são baldes de época fixos: se o departamento não gastar hoje, não acumula. Para repasse de capital isso é bom (limita o dreno diário); para "orçamento trimestral" você quer `lifetime_max` com uma sessão nova por trimestre.

### 2.3 Contabilidade: a parte que já é um produto

Todo pagamento carrega `reference` — obrigatória, sem default, e parte do preimage do `intent_id`. Ela é o nome de *o que está sendo liquidado*: número de nota, hash de documento, id de tarefa. Some isso com `seq` + `audit_head` por sessão e você tem, sem construir mais nada no programa:

- gasto por agente (sessão), por cargo (política), por departamento (treasury), por mint;
- rastreio de cada saída até um id de tarefa externo;
- **prova de não-omissão** — a cadeia de hash torna detectável não só a alteração de um registro, mas a *remoção* dele. Logs off-chain concorrentes só provam a primeira coisa.

Isso é um razão contábil de organização de agentes, verificável por terceiros. Volta na §6 como linha de receita.

### 2.4 O que falta para "organização" ser um conceito de primeira classe

Hoje a hierarquia é uma *convenção de montagem*: nada no programa sabe que uma treasury é filha de outra. As lacunas, em ordem de custo:

| Lacuna | Custo | Comentário |
|---|---|---|
| Nenhum vínculo pai-filho on-chain | Baixo — cabe em bytes reservados (`parent: Pubkey`) | Sem isso, "consolidar o gasto da empresa" é um trabalho do indexer, não uma query |
| Sem propagação de teto | Médio | Hoje cada teto é independente; baixar o teto da raiz não aperta os filhos |
| Sem pause em cascata | Médio | Pausar a raiz **não** pausa os filhos. Num incidente é isso que você quer, e não existe |
| Sem papel "lead" que realoque entre filhos | Alto, e perigoso | Qualquer versão disso reintroduz escalada de privilégio. Provavelmente deve continuar não existindo |
| Sem clawback | Alto, e provavelmente errado | Se o pai pudesse sacar do filho, o filho não teria garantia nenhuma |

Minha leitura: **o pause em cascata é a única dessas que eu construiria**, e ela é v1.1 (um `pause` que aceita uma lista de filhos declarados, ou um `parent` cujo `paused` os filhos consultam). O resto é indexer ou é veneno.

---

## 3. Agentes de trading, Kamino, Drift, LP, lançamento de token

### 3.1 Por que não cabe no programa de hoje

O programa tem 23 instruções e **todas** são ou configuração ou transferência. `execute_payment` é literalmente uma instrução de programa e uma CPI de token, com orçamento de ≤45k CU. Não existe caminho para chamar um programa de terceiro.

Emprestar na Kamino, abrir posição na Drift, prover liquidez ou comprar no lançamento exigem CPI arbitrária: programa arbitrário, instrução arbitrária, conjunto de contas arbitrário. Isso não é uma extensão — é a inversão da tese. A meta declarada em `ARCHITECTURE.md` §1 é *zero dependências de programas externos*, e ela existe porque cada programa no caminho é superfície de ataque herdada.

E tem um problema mais fundo que "é difícil de validar": **os limites atuais medem a coisa errada para DeFi.** A política é denominada em *quanto sai do cofre*. Em DeFi, quanto sai do cofre não é o risco:

- depositar $1.000 de colateral na Drift e abrir 20x é $1.000 saindo e $20.000 de exposição;
- entrar numa pool de liquidez é $1.000 saindo e uma perda impermanente desconhecida;
- comprar um token no dia do lançamento é $1.000 saindo e uma probabilidade material de $0 voltando.

Um `per_tx_max` de $1.000 não limita nada disso. Ele dá a *sensação* de limite — que é pior do que não ter, num produto cuja única proposta é a garantia ser real.

### 3.2 O que uma versão DeFi de verdade exigiria

Para ser honesto sobre o tamanho: seria um programa novo, com ADRs próprios e auditoria própria.

1. **Allowlist de programa + discriminador** — não basta permitir "Kamino"; tem de ser "Kamino, instrução `deposit`", porque `withdraw` para um destino arbitrário está no mesmo programa.
2. **Templates de restrição de conta** — a parte genuinamente difícil. Numa CPI, o dano mora em *qual conta ocupa qual posição*. Você teria de expressar "a conta 3 tem de ser uma PDA derivada da minha treasury" de forma declarativa e barata em CU. Todo projeto de "transaction guard" empaca aqui.
3. **Limites denominados em risco** — nocional, alavancagem, health factor, drawdown. Todos exigem oráculo *dentro* da checagem de política, o que quebra o `#![no_std]` sem dependência de Solana que hoje deixa o crate ser provado com Kani.
4. **Contabilidade de posição** — um pagamento é terminal; uma posição é um saldo que muda de valor sozinho. `SpendCounter` não modela isso. Você precisaria de marcação a mercado, ou seja, de novo oráculo.
5. **Caminho de retorno** — de quem é o lucro, e como ele volta ao cofre sem criar um caminho de saque que não seja do owner.

Isso é uma reescrita, não um `v1.1`. E te coloca em concorrência direta com Brahma, Almanak e Giza (§4.2), que estão nisso há anos, em EVM, com volume real.

### 3.3 A reformulação que eu defendo: alocação, não operação

O modelo de mesa proprietária: **uma mesa recebe um limite de capital, não uma permissão de operar.** O risk manager não aprova cada trade — ele controla quanto capital a mesa pode puxar e com que velocidade, e mata a mesa se o número ficar feio.

Mapeado no que já está construído, sem nenhuma linha nova:

```
Treasury TRADING ──execute_payment──► carteira operacional do agente
  política: $5k por tx, $15k/dia, $100k vitalício                    │
  destino: uma única AllowlistEntry (a carteira do agente)           │
  cadeia de auditoria: toda alocação registrada com seq + hash       ▼
                                                    o agente opera livre:
                                                    Kamino, Drift, Jupiter,
                                                    LP, lançamentos — o que for
                                                              │
                                    devolução: transfer comum para a vault ATA
                                    (depósito é permissionless por construção)
```

O que essa fronteira te dá, de verdade:

- **Perda máxima conhecida e provada on-chain.** O agente perde no máximo o que foi pingado. Não é retórica: é a mesma garantia que o programa já prova para pagamento.
- **Velocidade de dreno limitada.** Um agente que descobre uma "estratégia" ruinosa às 3h da manhã sangra no ritmo da janela curta, não de uma vez. Isso é o que transforma um incidente em um alerta.
- **Kill switch que funciona** — guardian pausa, o pingo para. O agente ainda tem o que já sacou, mas a torneira fecha.
- **Devolução sem privilégio.** Depositar no cofre é uma transferência de token comum para a ATA; qualquer um pode. Lucro volta sem nenhuma instrução nova.
- **Cadeia de auditoria vira track record.** Toda alocação para aquele agente, com selo temporal, mais o saldo que voltou — é uma curva de P&L verificável por terceiro. Volta na §6.4.

E o que ela **não** te dá, e isso precisa estar na documentação em letras garrafais: **Agent Rails limita a alocação, não o resultado.** Uma vez fora do cofre, o dinheiro está sujeito ao julgamento do agente e à composabilidade do DeFi. Quem vender isso como "trading seguro" está mentindo. O que se vende é *exposição limitada*, e isso é bastante.

### 3.4 Sobre as ideias específicas que você trouxe

| Ideia | Cabe hoje? | Como |
|---|---|---|
| Agente de pesquisa de mercado que paga por dados/APIs | **Sim, é o caso de uso central** | Política com allowlist de fornecedores, tetos baixos, MCP. É literalmente o que o produto faz |
| Agente com "saldo próprio" | **Sim** | Sessão com `lifetime_max` = a mesada. O saldo é o contador |
| Lead delegando para sub-agentes | **Sim, via treasury-filha** (§2.2) | Repasse de dinheiro, nunca de limite |
| Empréstimo na Kamino / Aave | Não no programa; **sim via alocação** (§3.3) | Fronteira: o cofre financia a carteira operacional |
| Margem/perp na Drift | Não no programa; **sim via alocação** | A Drift já tem *delegated accounts* — a conta é sua, o agente só opera. Combina bem: Agent Rails financia, a Drift delega operação |
| Pool de liquidez | Não no programa; **sim via alocação** | Mesma fronteira |
| Comprar token no lançamento | **Sim via alocação, e é o pior caso para allowlist** | Um token novo não tem como estar numa allowlist de mints. Este é o caso que *obriga* o modelo de alocação |
| Sugerir setups de ações/commodities | **Sim, e não toca o programa** | Sugerir é off-chain. Se virar execução, é uma corretora — e aí é a v2 "adaptadores TradFi" do roadmap, com o `PaymentIntent` assinado como formato comum |

---

## 4. O que já existe (pesquisa)

### 4.1 Concorrência direta na tese de Agent Rails

- **`mercantill`** (Cypherpunk, set/2025, **4º lugar Stablecoins, $10k**) — *"Enterprise banking infrastructure providing spending safeguards and audit trails for AI agents"*, construído sobre Squads Grid. Tags de problema: "uncontrolled ai agent spending", "lack of enterprise agent auditability". Time de 1 pessoa. **É a coisa mais próxima do seu pitch que existe no corpus** — e a diferença é arquitetural: eles compõem sobre um multisig existente (garantia = Squads + servidor deles), você é o programa que enforce. Vale estudar o posicionamento; o deles é mais comercial que o seu.
- **Solana Subscriptions & Allowances** (nativo, mainnet, auditado Cantina/Spearbit) — o primitivo "delegado gasta até um teto, com expiração". Já coberto na pesquisa anterior; continua sendo a razão para **não** posicionar Agent Rails como "mais um jeito de limitar gasto".
- **Swig** (Anagram) — smart wallet Solana com session keys, permissões delegadas, limites de saque, restrições por tipo de ação e por tempo. Está mais perto de "permissão por ação" do que o primitivo nativo.
- **Squads Spending Limits / Grid** — limite por membro sem proposta de multisig; base do Mercantill.
- **`blockpal-smart-delegation`** (Breakout) — "programmable guardrails" para agentes, sem cadeia de auditoria nem separação owner/operator/guardian documentada.

### 4.2 Agentes DeFi com mandato (o espaço que você perguntou)

Esta é a parte que a pesquisa anterior não cobria, e é onde a concorrência é séria — **toda ela em EVM**:

- **Brahma ConsoleKit** — a arquitetura mais parecida com o que seria um "Agent Rails DeFi": sub-contas Safe, cada uma governada por uma **policy engine modular** que define quais ações são permitidas, com o usuário mantendo custódia e delegando execução com restrições. Eles já enviaram agentes verticais em cima disso (Morpho Agent, rebalanceamento automático de vaults). É literalmente a §3.2 deste documento, construída, em Ethereum. ([Brahma docs](https://docs.brahma.fi/brahma-consolekit), [Decrypt](https://decrypt.co/310450/brahma-introduces-agentic-protocols-for-secure-onchain-automation))
- **Giza / ARMA** — agente autônomo de otimização de rendimento em stablecoin (Aave, Morpho, Compound, Moonwell). Números divulgados: ~$3,96 bi de volume agêntico até mar/2026, 25.000+ instâncias de agente, $35 mi de capital otimizado, 102.000+ transações. Não-custodial. ([Giza docs](https://docs.gizaprotocol.ai/introduction/agents), [Finbold](https://finbold.com/gizas-autonomous-yield-optimization-agent-arma-goes-live-on-the-base-network/))
- **Almanak** — SDK Python + plataforma no-code com "swarm" de 18 agentes que pesquisa, simula, implanta e gerencia risco de estratégias DeFi. Não-custodial via smart accounts, com permissões auditáveis pelo usuário. ([blocmates](https://www.blocmates.com/articles/almanak-your-personal-ai-quant))
- **Lit Protocol Vincent** — aparece no Grid como `ai_agent` com produto de permissões de agente governadas por política. Concorrente na camada de permissão, cross-chain.
- **Drift delegated accounts** — a Drift já permite conceder a outra conta permissões limitadas (depositar, colocar/cancelar ordens) e integrou com o Solana Agent Kit, então agentes já operam perps, lending e vaults delegados. **Isso é o parceiro natural do modelo de alocação da §3.3, não um concorrente.** ([Drift](https://x.com/DriftProtocol/status/1884261424802988459))
- **Solana Agent Kit** (SendAI) — a camada de "agente consegue chamar todo protocolo Solana". Compara taxas entre Kamino, MarginFi, Drift, Jupiter Lend, Loopscale e deposita na melhor. Nenhuma camada de guardrail. É exatamente o executor que o seu modelo de alocação financiaria.

**Leitura:** o espaço "agente executa DeFi com política" **já tem incumbentes com volume real** — e nenhum deles é Solana-first. O espaço "quanto de capital esse agente pode puxar, com prova" continua vazio nos dois ecossistemas.

### 4.3 Organizações de agentes

- **Virtuals ACP (Agent Commerce Protocol)** — agente cliente posta um trabalho e **trava o orçamento em escrow on-chain**; agente provedor entrega; um avaliador confirma antes de liberar. Beta público. Mais de 1,77 mi de trabalhos concluídos e ~$479 mi de "aGDP" reportados em fev/2026. ([RockawayX](https://www.rockawayx.com/insights/virtuals-agent-commerce-protocol-in-public-beta))
- **Olas (Autonolas)** — 9 mi+ de transações agente-a-agente, 600+ agentes diários ativos, 9 blockchains até o 3T/2025; Mech Marketplace para agentes contratarem agentes; citado ao lado de Mastercard e Cloudflare na cobertura de agentic commerce. ([Forbes](https://www.forbes.com/sites/sandycarter/2026/09/02/agentic-commerce-is-here-as-mastercard-cloudflare-and-olas-build-rails/))
- **`xfriends-(by-characterx)`** (Renaissance, menção honrosa) — agentes autônomos que detêm carteiras e formam "DAOs sintéticas". Direção conceitual parecida, execução de hackathon.
- **`ai-economy-protocol-(aep)`**, **`habili-agent-network`**, **`neuraltrader`** (Breakout/Cypherpunk) — marketplace de agentes com escrow, colaboração entre agentes, economia virtual de agentes negociando. Todos na camada de *coordenação*, nenhum na de *governança de tesouraria*.
- **Literatura:** *"From Logic Monopoly to Social Contract: Separation of Power and the Institutional Foundations for Autonomous Agent Economies"* (arXiv 2603.25100) argumenta que sistemas multi-agente falham por **"monopólio de lógica"** — o agente planeja, executa e avalia a si mesmo — reportando 84,3% de sucesso médio de ataque em dez cenários, e propõe separação de poderes (legislar / executar / julgar) como infraestrutura institucional. **Esse paper é a justificativa acadêmica da sua arquitetura de papéis**, escrita por gente que não sabe que você existe. Vale citar em grant e em pitch.

### 4.4 Arquivo cripto

- **"Interpreting Power: The Principle of Least Authority"** (Nakamoto Institute) — rastreia o princípio da menor autoridade de Locke e dos escritos revolucionários americanos até a teoria de segurança moderna: *"nenhum homem, ou corpo de homens, deve receber mais comando do que o absolutamente necessário para cumprir o ofício que lhe foi confiado."* A separação owner/operator/guardian/session é uma enumeração de poderes no sentido literal — e o guardian, que só aperta e nunca afrouxa, é o caso limite.
- **Nick Szabo, "Rights, Remedies, and Security Models"** — formaliza autoridade delegada e mostra como agrupar direitos e deveres em "autoridades" faz perder o obrigado original como fiador. É o argumento contra dar ao agente-lead a chave de operador (§2.2).
- **sRFC 00009 / sRFC 00012** (Solana forum) — padrões emergentes de delegação por smart wallet e prova de propriedade. Vale acompanhar: se virarem padrão, "como um agente prova por quem age" deixa de ser decisão sua.

### 4.5 Saturação

- The Grid, produtos `ai_agent` + `ai_agent_platform` + `ai_agent_framework` com tag Solana, excluindo descontinuados: **138 produtos, 111 raízes distintas.** O espaço "agente na Solana" está lotado.
- Análise de hackathon (Breakout abr/2025 + Cypherpunk set/2025, 2.992 projetos): AI é 16,7% do Breakout, DeFi 25,1% do Cypherpunk. As tags de problema mais frequentes são "information overload", "information asymmetry", "rug pulls" — **"uncontrolled ai agent spending" não aparece no topo**, e as únicas ocorrências que achei são do Mercantill.
- Portfólio de aceleradora: sem sobreposição direta. Os mais próximos são `mcpay` (C4, 1º lugar Stablecoins — MCP, mas do lado de *cobrar*), `lomen-ai` (C5 — agentes DeFi móveis, executor, não guardrail) e `dynamic-maps` (C5 — pagamento USDC por agente).

**Conclusão de saturação:** muitos agentes, muitos executores, quase nenhum guardrail. Isso é bom e ruim — bom porque o espaço está livre, ruim porque pode significar que ninguém está comprando guardrail ainda. §7 trata disso como risco.

---

## 5. Onde está a sua vantagem (e onde não está)

### 5.1 Vantagem real

1. **A garantia é do programa, não de um servidor.** Brahma, Almanak, Giza e Mercantill todos têm uma peça off-chain confiável no caminho. Você não. Isso é checável em dez segundos com `solana program show`, e não vira PDF de trust center.
2. **Quatro papéis com poderes enumerados, e o afrouxamento só desce.** Nenhum concorrente pesquisado separa owner / operator / guardian / sessão. O paper da §4.3 diz que essa é *a* falha estrutural dos sistemas multi-agente, e você já implementou a solução.
3. **Cadeia de hash por sessão.** Prova de **não-omissão**, não só de não-alteração. É o único dos seus diferenciais que gera um artefato vendível para um orçamento que não é o de engenharia (§6.3).
4. **Superfície MCP sem escalada de privilégio, por construção e com teste.** `tool-surface.test.ts` é uma afirmação testada, não uma promessa. Num mundo onde prompt injection é o vetor real, "o argumento da ferramenta não alcança o campo privilegiado" é uma frase de vendas forte.
5. **Rigor formal que ninguém mais tem nesse nicho.** Crate `no_std` sem dependência de Solana, `forbid(unsafe_code)`, aritmética `checked_*`, proptest, fuzz, provas Kani, 99,2% de cobertura, pirâmide de 5 camadas. Contra hackathon-ware isso é diferença de categoria; contra Brahma é paridade defensável.
6. **Hierarquia sem código novo** (§2.2). Nenhum concorrente pesquisado tem uma composição de tesouraria em árvore que caia de graça do modelo de contas.

### 5.2 Onde você **não** tem vantagem

- **Limitar gasto simples.** Commoditizado. Solana Allowances é nativo, grátis, auditado e integrado a Squads e Swig. Competir aqui é perder.
- **Execução DeFi.** Brahma tem policy engine modular em produção; Giza tem $3,96 bi de volume; Almanak tem 18 agentes e simulação. Você tem zero linhas de CPI para protocolo externo e uma meta arquitetural que diz para não ter. Entrar aqui é começar 3 anos atrás, no ecossistema errado.
- **Distribuição.** Eles têm token, comunidade e volume. Você tem um repo de 10 dias com CI verde.
- **Ser o executor.** Solana Agent Kit já é o executor, tem a SendAI atrás e integrações com metade do ecossistema. Boa notícia: executor é complemento, não concorrente.

### 5.3 O posicionamento que a pesquisa sustenta

> **Agent Rails é a camada de alocação de capital e prestação de contas de uma organização de agentes. Não é onde o agente age — é onde se decide de quanto ele dispõe, e onde fica a prova.**

Três consequências concretas:

- Pare de se comparar com Allowances. Comece a se comparar com **ERP / controladoria**, e com Brahma na parte de política.
- O executor DeFi (Solana Agent Kit, Drift delegated accounts, Kamino) é **integração**, e a integração é um post: *"como financiar um agente de trading da Drift com um limite diário provado on-chain"*. Isso é distribuição barata dentro do ecossistema Solana e não exige nenhuma linha de programa.
- O pitch de organização — departamentos, leads, mesada por agente, auditoria consolidada — é seu de forma única e **já está construído**. Falta demo, não código.

---

## 6. Modelos de negócio

Consolidando `revenue-model-analysis.md` (que continua válido) com as linhas que a direção organização/DeFi abre. A restrição que decide tudo continua a mesma: **o dinheiro passa por uma PDA que o cliente controla, e nunca tocá-lo é o produto inteiro.** Não existe pedágio nessa estrada por construção, e um fee on-chain é irreconciliável com o congelamento do programa (decidido: sem fee de protocolo na v1 — a data limite dessa decisão é a auditoria).

### As linhas, em ordem de encaixe × defensabilidade ÷ esforço

**6.1 ★ Guardian-as-a-Service** — o cliente coloca sua pubkey num dos cinco slots de guardian. Você monitora o stream de eventos e chama `pause` quando algo parece errado. O pior que um serviço de segurança totalmente comprometido pode fazer com o cliente é **desligar o agente dele**. Isso é checável on-chain, e é uma conversa de vendas que quase ninguém em segurança consegue ter. Precificação pelo teto protegido — o cliente já publicou, on-chain, em `long_window_max`, o máximo que aceita perder. Modo dry-run como padrão (alerta sem pausar), porque um falso positivo é um incidente de produção.
*Novo com este documento:* a versão **risk guardian para mesa de agentes** — pausa por drawdown, por velocidade de alocação, por concentração num destino. É o mesmo serviço com regras de risco em vez de regras de fraude, e vende para um comprador que entende risco.

**6.2 ★ Indexer hospedado + console** — publique o `@agent-rails/indexer` em Apache-2.0 e venda o hospedado: ingestão gerenciada, retenção, `verifyChain`, alertas, export. Custo marginal real (Yellowstone/retenção é caro de verdade), zero risco de custódia, e o caminho grátis continua honesto porque `list_payments` degrada para "unavailable". Mais próximo de commodity que 6.1, mas é o substrato compartilhado embaixo de 6.1, 6.3 e 6.4 — construa uma vez.

**6.3 ★ Atestações de conformidade e auditoria** — transformar `audit_head` num artefato que a área financeira paga: um relatório periódico, assinado, verificável de forma independente, de que *todo pagamento deste agente no trimestre esteve dentro da política declarada, e aqui está a cadeia de hash provando que nenhum foi omitido*. Só você pode vender isso: concorrente com log off-chain prova que não editou, não prova que não apagou. Comprador é risco/compliance, não engenharia — orçamento diferente, disposição a pagar muito maior, renovação no calendário de auditoria. Dê o verificador de graça; é ele que torna a atestação vendável.

**6.4 ★★ Contabilidade e controladoria de organização de agentes** — **linha nova, criada pela análise da §2.3.** Com `reference` obrigatória em todo pagamento e a árvore de treasuries da §2.2, o indexer produz: custo por agente, por cargo, por departamento; rastreio até id de tarefa; alocação vs. retorno por agente de trading; consolidado da empresa. É um SaaS de FinOps para organizações de agentes, e o dado que ele consome é gerado pelo programa sem esforço adicional. Encaixa em 6.2 (mesma ingestão) e vende junto com 6.3 (mesmo comprador). **Na minha leitura é a segunda linha mais forte do documento, atrás só de 6.1** — e é a única que só existe porque você modelou `reference` e a árvore do jeito que modelou.

**6.5 ★★ Track record verificável de agente** — **linha nova.** A cadeia de auditoria de uma sessão de trading é uma curva de alocação com selo temporal; somada ao saldo devolvido ao cofre, é um P&L que um terceiro pode verificar sem confiar em quem publica. Isso é a matéria-prima de um *registro de reputação de agentes*: "este agente recebeu $X em 40 alocações e devolveu $Y, provado". Vale para marketplaces de agentes (Virtuals, Olas), para quem aloca capital em estratégias de agente, e como camada de descoberta. **Risco:** é um mercado de dois lados e depende de adoção prévia — não é o primeiro produto, é o que a adoção habilita. Anote, não construa agora.

**6.6 Pacotes de política e feeds de screening** — a interface `PolicyHook` é um ponto de extensão vazio. Encha com *dado mantido*: listas de endereços sancionados e de drainers, classificação de risco de mint (honeypot, freeze authority viva, extensões surpresa), pacotes Cedar/OPA para formatos comuns (só horário comercial, orçamento por fornecedor, pagamento casado com nota). A interface é grátis, o feed é assinatura — padrão Snyk/Semgrep, sobrevive a fork porque o fork leva o código, não as atualizações. **Obrigatório na documentação:** política soft não é a garantia, e o resultado precisa ter quatro estados (`match` / `possible` / `no_match` / **`unavailable`**) para que uma queda do feed nunca leia como "permitido".

**6.7 Relayer (v1.1)** — no modo signed-intent o agente assina off-chain e um relayer submete `[Ed25519Program.verify, execute_payment]`. O `fee_payer` já é conta separada da `session_key` exatamente para isso. Cobre gas + margem, medido por transação. Pequeno, com custo unitário óbvio, e ninguém mais vai construir um que entenda `PaymentIntent`. **Pule o managed signing** — Turnkey, Privy, Dfns e Fireblocks já vendem isso, e a arquitetura deliberadamente faz qualquer signer compatível com Kit funcionar sem cola.

**6.8 Grants e financiamento de ecossistema — a jogada correta agora** — não-dilutivo, não exige clientes nem produto hospedado, e **financia a auditoria, que é pré-condição de todas as outras linhas**. Ninguém coloca tesouraria real atrás de programa não auditado. O trabalho já tem formato de grant: bem público, Apache-2.0, na Solana, com histórico de ADRs e pirâmide de testes que quase nenhum candidato consegue mostrar. Superteam Brasil é o caminho natural.

**6.9 Enterprise: integração, adaptadores, suporte** — margem alta, caixa imediato, zero infraestrutura, e não escala além das suas horas. Aceite só o que produzir um cliente de referência ou um adaptador reutilizável. Um acordo de "design partner" (integração com desconto em troca de estudo de caso público e feedback detalhado) vale mais que o honorário nesta fase.

**6.10 Distribuição (não é receita, é o insumo de tudo acima)** — `npx agent-rails init` com "menos de cinco minutos até o primeiro pagamento guardado"; adaptadores LangChain / AI SDK / OpenAI Agents; pacote PyPI; adaptador x402. **Novo daqui:** uma integração-demo com **Drift delegated accounts** ou **Solana Agent Kit** mostrando o modelo de alocação da §3.3 é a peça de distribuição com melhor relação custo/impacto que existe hoje — é um fim de semana de trabalho e responde a pergunta que o ecossistema inteiro está fazendo.

**6.11 Estratégico / aquisição** — vale dizer em voz alta porque muda o que se otimiza: o desfecho grande mais provável para um primitivo não-custodial de controle de gasto de agente é **aquisição por um adjacente** — Squads, Turnkey, Privy, Dfns, uma carteira, uma plataforma de tesouraria. Todos têm clientes perguntando "como deixo um agente gastar sem entregar as chaves" e nenhum tem resposta limpa. O que aumenta esse valor não é receita: é adoção, auditoria, programa congelado e proveniência Apache-2.0 sem ambiguidade. Mesma lista de sempre.

### O que não funciona

| Ideia | Por quê |
|---|---|
| Fee de protocolo no `execute_payment` (v1) | Irreconciliável com a imutabilidade; removível com uma linha num fork; taxa a adoção que você ainda não tem |
| Custódia / ganhar float | Destrói a única alegação diferenciadora. Não é trade-off, é erro de categoria |
| Token | Não há sink: sem fee para distribuir, sem papel de staking que a chave de guardian não preencha melhor, e sem decisão de governança depois do congelamento |
| Gatear as ferramentas MCP ou o SDK | A superfície do agente é a superfície de adoção. Gatear mata o funil de todas as linhas |
| Cobrar pelo verificador da cadeia | Atestação que ninguém pode verificar de forma independente vale menos, não mais |
| Reter fundos por inadimplência | Estruturalmente impossível (saque do owner sempre funciona, mesmo pausado) — e seria traição do design se fosse possível |
| Open-core dentro deste repo | Apache-2.0 + sem CLA. A edição comercial tem de nascer em repositório separado, decidido antes do primeiro PR externo |
| **Construir execução DeFi para competir com Brahma/Giza/Almanak** | **Novo daqui.** Reescrita completa, modelo de ameaça diferente, auditoria nova, três anos atrás dos incumbentes, e quebra a meta de zero dependências externas |

---

## 7. Sequenciamento e riscos

### O que eu faria, nesta ordem

1. **Demo do organograma** (dias, não semanas). Um script que monta raiz → 2 departamentos → 4 agentes, roda pagamentos nos três níveis e imprime a auditoria consolidada. Isso prova a §2.2, vira material de grant, vira post e responde "serve para montar uma empresa?" com um terminal em vez de um parágrafo.
2. **Demo de alocação para agente de trading** (§3.3) com Drift delegated account ou Solana Agent Kit do outro lado. É a peça de distribuição da §6.10 e posiciona você como complemento do ecossistema, não como concorrente dele.
3. **Grant + auditoria** (§6.8). Nada mais começa de verdade antes disso.
4. **Indexer Apache-2.0 → Guardian-as-a-Service + console + controladoria** (§6.1, §6.2, §6.4) no repositório separado.
5. Pause em cascata (§2.4) e `parent: Pubkey` nos bytes reservados, se e quando a demo do organograma encontrar usuário real.

### Riscos, honestamente

- **O maior: pode não haver comprador ainda.** As tags de problema do corpus de hackathon não mostram "gasto descontrolado de agente" como dor frequente — só o Mercantill. Ou você está cedo (bom, se sobreviver até o mercado chegar) ou a dor é menor do que parece. **Teste isso antes de construir o produto hospedado**, não depois: cinco conversas com quem já roda agente com dinheiro valem mais que cinco semanas de código.
- **Commoditização pelo protocolo.** Se a Solana Foundation estender Allowances para multi-limite simultâneo ou allowlist, a vantagem do núcleo estreita. Acompanhe o roadmap daquele programa de perto.
- **Incumbentes do lado DeFi.** Se Brahma ou Almanak resolverem ir para Solana, eles chegam com policy engine pronta e volume. Sua defesa é a camada de organização e a prova de auditoria, não a execução.
- **Complexidade do organograma.** Três níveis de treasury são três vezes mais contas para o operador gerenciar. Sem uma CLI que faça isso em um comando, ninguém monta na mão. A CLI virou pré-requisito do pitch de organização, não um item de conveniência.
- **Risco narrativo:** "agente de trading" atrai o público errado e a pergunta errada ("quanto rende?"). O produto é limite de perda, não retorno. Se o marketing escorregar para retorno, você herda expectativas que a arquitetura explicitamente não atende.

### Perguntas que só você responde

1. Isso é uma empresa ou um bem público que se financia? A resposta muda §6 inteira.
2. Quem é o primeiro usuário que você **quer**: o dev solo ligando o Claude a uma carteira devnet, ou a empresa dando a um agente um mandato de $50k/dia? Eles precisam de produtos, docs e preços diferentes.
3. Você quer ser a camada de organização (§5.3) ou a camada de pagamento? As duas são defensáveis; a primeira é maior e menos disputada; a segunda é a que já está pronta.

---

## 8. Adendo — Bido, os trilhos de cartão, e o hackathon

*Acrescentado em 2026-09-16, após pesquisa dirigida sobre a Bido.*

### 8.1 O que a Bido é, verificado

[usebido.com](https://www.usebido.com/) — *"Discover, approve & buy, all in one AI."* Agente de compras para consumidor final:

- **Superfície:** um servidor **MCP** que o ChatGPT e o Claude já falam, mais integração por DM no Instagram. Mesma escolha de superfície que a nossa.
- **Mecanismo de autorização:** um **cartão virtual de uso único, travado no lojista, com teto de valor, moeda e janela de tempo**. O usuário confirma com **passkey**; quem valida é a rede de cartão, não a Bido.
- **Infra de pagamento:** tokenização da **Basis Theory** ("números de cartão nunca tocam a Bido"), PCI DSS nível 1.
- **Lojistas:** ~15 listados — Alo Yoga, Gymshark, SKIMS, Fenty Beauty, Ooni, Casper, Barnes & Noble.
- **Cripto:** nenhuma. Zero.
- **Preço/modelo:** não divulgado no site. Dado o conjunto de lojistas e o "encontra o melhor cupom", o modelo quase certamente é **comissão de afiliado sobre a venda** (possivelmente com participação em interchange do cartão virtual) — *isto é inferência, não dado confirmado*.
- **Time/captação:** não encontrado. O perfil da Crunchbase que aparece na busca é de outra empresa (leilão de domínio). Trate "quanto levantaram" como desconhecido.

### 8.2 Concorremos? Não — e a razão importa

Há **uma** ideia genuinamente compartilhada, e ela é significativa: a autorização **limitada, de uso único, escopada e expirável**. O cartão travado-no-lojista-com-teto-e-prazo da Bido é conceitualmente o mesmo primitivo que o nosso `PaymentIntent` + `AllowlistEntry` + `expires_at` + `IntentReceipt`. Duas equipes que não se conhecem chegaram ao mesmo desenho. Isso é **validação da tese**, não concorrência.

Fora isso, quase tudo diverge:

| | **Bido** | **Agent Rails** |
|---|---|---|
| Trilho | Rede de cartão (Visa/Mastercard) | Programa Solana, USDC/SPL |
| Quem garante | Regras de autorização do emissor + servidor da Bido | O programa on-chain |
| Quem aprova | **Humano, por compra, via passkey** | **Ninguém — a política já autorizou** |
| Direção | Consumidor comprando varejo | Organização financiando agentes |
| Papéis | Um usuário | Owner / operator / guardian / sessão |
| Limites | Teto do cartão, por autorização | Per-tx + janela curta + janela longa + vitalício, simultâneos |
| Auditoria | Extrato do emissor | Cadeia de hash com prova de não-omissão |
| Múltiplos agentes | Não é um conceito | É o modelo de dados inteiro |

A diferença que decide: **a Bido põe o humano em cada compra.** Para consumidor isso é correto — é fricção aceitável e resolve responsabilidade. Para uma organização de agentes é justamente o que precisa não existir; aprovar cada pagamento é ter um humano de plantão, que é o custo que estamos eliminando. São produtos para problemas diferentes.

### 8.3 O que essa pesquisa revelou e que faltava nas anteriores

**O concorrente real do Agent Rails hoje não é um programa Solana. É um cartão virtual.**

Quando alguém pergunta "como limito o gasto de um agente", a resposta de mercado em 2026 é *emitir um cartão virtual com teto*. E essa camada está capitalizada e institucionalizada:

- **Visa Intelligent Commerce** — credenciais tokenizadas, identidade de agente via Trusted Agent Protocol, liquidação em stablecoin a **~$7 bi de run-rate anualizado em nove blockchains** (abr/2026). Pilotos com Skyfire, Nekuda, PayOS, Ramp.
- **Stripe + OpenAI ACP** — Instant Checkout dentro do ChatGPT.
- **Nekuda** ($5M seed, Madrona, com Amex Ventures e Visa Ventures) — SDK de pagamentos agênticos com "Secure Agent Wallet" e **"Agentic Mandates"**. O nome deles para o nosso `Policy`.
- **Basis Theory** ($33M Série B) — a tokenização embaixo da Bido.
- **Skyfire** ($9,5M; a16z CSX, Coinbase Ventures).
- Seis protocolos concorrentes já definem a pilha (ACP, UCP, AP2, MCP, A2A, Visa TAP), com ~$50 mi divulgados só na camada de pagamento e identidade.

Isso muda o pitch. Contra cartão, "limite de gasto" não é diferencial — é paridade com algo que o Visa já faz melhor, com aceitação universal e chargeback. **Onde o cartão não vai**, e o programa vai:

1. **Pagar o que não é lojista** — outra carteira, outra treasury, um contrato, outro agente. Não existe MCC para "agente".
2. **Agente-para-agente e sub-centavo.** Interchange destrói micropagamento; x402 já roda ~75 mi de transações/mês majoritariamente abaixo de $1.
3. **Sem emissor, sem subscrição, sem KYC por agente.** Abrir uma sessão é uma instrução; emitir um cartão é uma relação bancária.
4. **Prova, não palavra.** O emissor te dá um extrato; nós damos uma cadeia de hash onde a *omissão* é detectável. Para auditoria, isso é a diferença inteira.
5. **Sem humano no loop.** O cartão pressupõe um portador. A política pré-autoriza.
6. **Verificabilidade por terceiro.** Qualquer um confere o programa com `solana program show`. Ninguém audita as regras internas de autorização do seu emissor.

### 8.4 Onde isso nos deixa fracos, dito com clareza

- **Alcance de lojista é zero.** A Bido tem Gymshark; nós temos uma allowlist e a exigência de que o outro lado aceite USDC na Solana. Para comprar bem físico no varejo, **o cartão ganha hoje, e vai continuar ganhando.** Não devemos disputar esse caso.
- **Aprovação humana por compra é um recurso que não temos** (`approval_threshold` está reservado para a v1.1). Para o comprador que *quer* isso, não temos resposta pronta.
- **Eles têm produto de consumidor vivo; nós temos programa não auditado em devnet.**

### 8.5 Recado para o hackathon

O **Crypto World's Fair** da Colosseum está **em andamento: 14/set a 12/out de 2026** — começou há dois dias. $840 mil em prêmios, $2,5 mi de capital semente, trilha Solana com $100 mil, e as equipes de destaque concorrem a $250 mil pela aceleradora. ([Colosseum](https://colosseum.com/worldsfair), [CryptoBriefing](https://cryptobriefing.com/colosseum-crypto-worlds-fair-hackathon/))

Há diferencial real para levar, mas ele **precisa ser enunciado contra o cartão, não contra o Solana Allowances**. As três frases que eu usaria:

1. *"Todo mundo está resolvendo como o agente paga. Nós resolvemos quanto ele pode perder — e provamos."*
2. *"Cartão virtual limita uma compra. Nós governamos uma organização de agentes: departamentos, mesada por agente, teto que só aperta descendo, e uma cadeia de hash em que apagar um registro é detectável."*
3. *"A garantia não é nosso servidor. É o programa — confira você mesmo."*

E o que **não** levar: "mais um jeito de limitar gasto de agente". Essa frase perde para o primitivo nativo da Solana por preço e para o Visa por distribuição.

O ativo mais subutilizado para uma submissão é a §2.2: **hierarquia de tesourarias funcionando hoje, sem código novo.** Uma demo de organograma rodando — raiz, departamentos, agentes, auditoria consolidada — é uma coisa que nenhum dos concorrentes pesquisados, cartão ou cripto, consegue mostrar.
