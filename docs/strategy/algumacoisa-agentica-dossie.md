# `lglucas/algumacoisa-agentica` — dossiê do repo-irmão

**Data:** 2026-09-17 · **Status:** levantamento, anterior à integração oficial · **Origem:** leitura completa do repo privado em 17/09
**Relaciona-se com:** `docs/strategy/product-strategy.md` (os três braços) · `docs/strategy/crypto-worlds-fair-playbook.md` (cronograma do hackathon)
**Serve para:** ter o estado do lado do Lucas registrado deste lado, antes de qualquer decisão conjunta. Não é acordo, é levantamento.

---

## 1. O que é, e como acessar

| | |
|---|---|
| Repositório | `lglucas/algumacoisa-agentica` — **privado**, "todos os direitos reservados" (`NOTICE.md`) |
| Dono | Lucas Galvão (lglucas), sócio de produto |
| Criado | 2026-09-17 19:43 UTC · último push 20:09 UTC |
| Nosso acesso | `push` (colaborador). Acessível por `gh api` / `gh repo clone`, **não** por fetch anônimo — WebFetch dá 404 |
| Linguagem declarada | JavaScript (só `scripts/codemap.js`) |
| Nome | **provisório.** `algumacoisa-agentica` é placeholder; nome real é a pendência P-01 deles |

**Código de produto: zero linhas.** Por decisão explícita — "escopo primeiro". O que existe é fundação documental: 7 documentos, 13 decisões numeradas com alternativa rejeitada, 6 pendências, 10 riscos com dono, e um session-log de fundação.

### A relação formal com este repo

`vendor/agent-rails` é **submódulo travado em `17c36aa`** (nosso HEAD em 17/09), apontando para `https://github.com/wayside-labs/agent-rails.git`. Regras que eles escreveram, e que nos convêm:

- atualização é comando explícito, com `git log HEAD..origin/main` na tela **antes** de aceitar;
- "nunca comitamos nem damos push dentro de `vendor/agent-rails`: é o repo dele";
- mudança no contrato vira **ADR e PR aqui**, no nosso formato — o `DECISOES.md` deles é só o registro do lado do produto.

Consequência prática imediata: **o submódulo não enxerga `org_chart.rs`**, que está sem commit deste lado. Hoje a demo mais forte do projeto é invisível para o sócio.

---

## 2. Estrutura do repo

```
algumacoisa-agentica/
├── .claude/                      # regras, agentes, hooks, 14 skills — vindos do ai-dev-operating-system dele
│   ├── rules/                    # code-style (200 linhas/arquivo), feature-based-architecture,
│   │                             #   codemap, git-workflow, secrets, security-baseline, privacy-audit
│   └── rules/adaptacoes-deste-repo.md   # declara o que NÃO se aplica dentro de vendor/agent-rails
├── docs/
│   ├── CONCEPCAO.md              # documento mestre — de onde veio, tese, garantias, como cada repo entra
│   ├── PRODUTO.md                # frase, conceito, cliente, UX, marketplace, escopo
│   ├── ARQUITETURA.md            # três planos, fluxo da operação, a peça nova, fontes de dados
│   ├── DECISOES.md               # D-01..D-13 + P-01..P-06
│   ├── RISCOS-E-LIMITES.md       # R-01..R-10, com dono
│   ├── REPOS.md                  # catálogo dos 8 repos avaliados, com licença e veredito
│   └── HACKATHON.md              # Crypto World's Fair: janela, divisão de trabalho, fatia vertical
├── scripts/codemap.js            # gera/valida CODEMAP.md
├── session-log/2026-09-17-fundacao-do-projeto.md
└── vendor/agent-rails            # submódulo → wayside-labs/agent-rails @ 17c36aa
```

---

## 3. A tese deles, em uma frase

> **Permissões de aplicativo, mas para dinheiro, garantidas on-chain.**

O agente declara em manifesto assinado pela carteira do autor o que precisa fazer com o dinheiro ("trocar SOL/USDC no Jupiter, até 200 USDC por semana, nunca enviar para fora do seu cofre"); **instalar** significa transformar esse pedido em política e sessão no nosso contrato. O que o agente não pediu, ele não consegue fazer — e isso não é promessa da plataforma, é o programa recusando.

E a virada da conversa de fundação deles: isso é o que torna um **marketplace** de agentes financeiros possível. A pergunta que mata qualquer vitrine desse tipo — *por que eu instalaria o agente de um estranho para mexer no meu dinheiro?* — só tem resposta com a garantia por baixo.

### Os três planos (a arquitetura deles)

| Plano | Onde roda | Licença | Responsabilidade |
|---|---|---|---|
| **Controle** | hospedado por eles | fechado | vitrine, manifesto, identidade do autor, ranqueamento, denúncia, cobrança, console/escritório pixel |
| **Execução** | máquina do cliente, VPS ou Docker | fechado | o agente, os MCPs dele, a chave de sessão, o SDK. É quem assina |
| **Garantia** | Solana | Apache-2.0 | o nosso contrato. Não confia nos outros dois |

A fronteira declarada: *"nós hospedamos a experiência, mas a chave que gasta nunca passa por nós."* **É a nossa invariante 1** (saída unilateral do dono) dita do lado do produto.

---

## 4. Onde ele encaixa nos braços

Ele **é o braço 3**, com um recorte melhor que o que eu tinha escrito — mas carrega dentro dele, como pré-requisito, uma peça que é **braço 2**.

| O que o repo propõe | Braço | Nota |
|---|---|---|
| Manifesto assinado, instalação, console pixel, vitrine, escada de confiança | **3** (superfície) | É o braço 3 |
| Instrução genérica de chamada a programa autorizado com retorno mínimo (D-04) + teto de capital exposto sem oráculo (D-05) | **2** (Mandate, camada 2) | Redescoberto independentemente |
| A garantia embaixo | **1** (Rails) | Consumido como está, por submódulo |

### O recorte do braço 3 que eu tinha errado

`product-strategy.md` §7 propõe o braço 3 como **Terraform para organização de agentes**: `org.yaml`, `mandate apply`, revisável em PR, comprador enterprise. Lucas propõe **permissão de aplicativo para dinheiro**: manifesto assinado pelo autor, instalar = virar política e sessão, comprador varejo.

São **o mesmo mecanismo com dois compradores**. O manifesto assinado *é* o `m.yaml`, escrito pelo autor do agente em vez do operador do cofre. O caminho certo é um materializador com duas caras — YAML para quem revisa em PR, manifesto para quem clica em instalar.

### As convergências independentes (o sinal mais forte do levantamento)

Os dois documentos foram escritos no mesmo dia, sem se verem, e chegaram na mesma peça:

| Nosso `product-strategy.md` | `ARQUITETURA.md` deles |
|---|---|
| §6.1 — "eles validam a ação antes; **nós validamos o resultado depois** — e a atomicidade transforma isso em garantia" | "**depois** da chamada, o saldo recebido é maior ou igual ao mínimo declarado — senão a transação inteira é desfeita" |
| §6.2 — camada 2 sem oráculo; oráculo é camada 3 e quebra as provas Kani | D-05 — "não medir perda, **limitar exposição**"; medir exigiria oráculo, contra a tese de enforcement sem terceiros |
| §6.4 — a authority operacional tem de ser PDA que só o nosso programa assina | D-04 — verificar só as contas que **o próprio contrato derivou**, nunca as que vieram de fora |
| Invariante 1 — saída unilateral do dono | D-09 — a chave de sessão nunca passa por eles |
| Invariante 3 — ninguém aumenta o próprio teto | D-06 — só o dono autoriza programa externo; operador e agente não |

Duas derivações independentes no mesmo desenho valem mais que qualquer um dos dois documentos sozinho.

---

## 5. As decisões deles (D-01..D-13), condensadas

| # | Decisão | Alternativa rejeitada |
|---|---|---|
| D-01 | Produto em repo próprio, privado, consumindo o agent-rails | copiar definições nossas (segunda fonte de verdade); esperar publicação no npm |
| D-02 | Submódulo com atualização deliberada, travado em `17c36aa` | acompanhar `main` e acordar com o produto quebrado |
| D-03 | Uso real, não demonstração — dado on-chain correto acima de estética | — (consequência: duas fontes de dados obrigatórias) |
| **D-04** | **Instrução genérica de chamada a programa autorizado com retorno mínimo** | instrução por protocolo — cada protocolo novo exigiria nova auditoria do núcleo |
| **D-05** | **Limitar capital exposto, não perda** | medir perda de posição aberta, que exigiria oráculo |
| D-06 | Autorização de protocolo externo é **do dono** | operador ou agente autorizarem |
| D-07 | Sem questionário de perfil de investidor; uma pergunta em dinheiro | perfilamento (fricção + caracteriza recomendação); pré-preencher com a média de usuários |
| **D-08** | **Manifesto assinado pela carteira do autor** | manifesto sem assinatura — reputação e denúncia viram enfeite |
| D-09 | Três planos, com a chave fora do alcance deles | chave de sessão passando pelo plano de controle |
| **D-10** | **Licença separada: contrato Apache, produto fechado** | usar código AGPL no produto fechado (obrigaria a abrir) |
| D-11 | Front a partir de fork do Pixel Agents (MIT, 9,3k★, fronteira `HookProvider`) | reescrever do zero |
| D-12 | Nenhuma responsabilidade por prejuízo dentro do limite autorizado | — (tensão registrada com o percentual sobre resultado) |
| D-13 | Rede: surfnet forkado e devnet; mainnet com valor real só depois | demonstrar em mainnet dentro da janela |

### Pendências deles

| # | Pendência | Quem decide | Nossa leitura |
|---|---|---|---|
| **P-02** | Quantos tokens por cofre (hoje `MAX_MINTS = 4`, no layout de bytes) | **Ronaldo** | Ver §6 — a resposta é mais cofres, não mais mints |
| **P-03** | Percentual sobre resultado: mantém, corta, ou só assinatura | Lucas | Ver §6 — `product-strategy.md` §8.2 já tem variante melhor |
| **P-06** | A peça nova entra antes do congelamento da 1.0 | **Ronaldo** | Ver §6 — a resposta é "não entra neste programa" |
| P-01 | Nome do produto e do repo | ambos | Ver §7 — três nomes, três posturas |
| P-04 | Console e vitrine no mesmo app ou separados | brainstorming | — |
| P-05 | Onde mora o agendamento das tarefas do agente | brainstorming | Muda quem precisa estar de pé para o agente rodar |

### Riscos que eles registraram (R-01..R-10)

Técnicos: **R-01** 4 tokens por cofre está no layout de bytes com teste de retrato · **R-02** chamada a programa externo é a superfície mais perigosa da Solana · **R-03** sem oráculo não há como medir perda de posição aberta · **R-04** MCP de terceiro é o vetor de injeção mais provável — o limite contém o prejuízo, não evita o engano · **R-05** *verde local não prova que rodou* — eles leram a nossa lição do `VERIFY_STRICT` e exigem que a esteira deles **falhe**, e não pule, quando faltar ferramenta.

Jurídicos: **R-06** percentual sobre resultado × "nenhuma responsabilidade" · **R-07** licença de terceiros · **R-08** pessoa sem conhecimento de web3 operando dinheiro com IA é o público-alvo declarado *e* o maior risco reputacional · **R-09** aviso ao cliente, a redigir, cuja natureza depende do R-06.

Execução: **R-10** o risco não é velocidade, é **ordem** — a peça on-chain precisa estar utilizável antes de o front depender dela.

---

## 6. As três correções a levar para a integração oficial

### a) A peça nova não pode entrar no programa do Rails (responde P-06)

O D-04 deles põe a instrução genérica dentro do `agent_rails`. CPI para programa arbitrário dentro do programa que vai ser **congelado e auditado** destrói exatamente a alegação que sustenta os dois braços. Vale a regra 1 do `product-strategy.md` §6.6: **Mandate pode depender de Rails; Rails nunca depende de Mandate.**

E a composição correta **já funciona hoje, sem código novo** — é o `org_chart.rs`: o cofre do mandato é mais um filho no organograma, uma `AllowlistEntry` com a PDA do mandato como `destination_owner`, e `execute_payment` financia a operação. Consequência de graça: **um comprometimento total do programa de mandato fica limitado pela política de Rails que o financia.**

Programa próprio ⇒ program id próprio, ADRs próprias, auditoria própria, e README dizendo em negrito que ele **não herda** a postura do Rails.

### b) O Gate 2 precisa ser dito em voz alta

`product-strategy.md` §10 — não começar a camada 2 antes da auditoria do Rails estar financiada. O cronograma deles põe a instrução nova no caminho crítico de 25 dias. Isso **não é violação**: o D-13 já restringe a demo a surfnet/devnet, e o gate trata de capital real em mainnet. Mas sem isso escrito, a deriva é previsível — a demo funciona, alguém sugere mainnet, e viramos dois programas não auditados com um orçamento de auditoria, que é a pior posição possível.

### c) P-03 já tem resposta melhor: fee de gestor terceiro

`product-strategy.md` §8.2: o programa suporta **fee opcional definida pelo dono, paga a um gestor terceiro**. No enquadramento de marketplace isso cai perfeito — quem cobra performance é o **autor do agente**; a plataforma cobra assinatura e listagem. Vendemos infraestrutura para o modelo dos outros e ficamos fora de "gestão de recursos de terceiros" (R-06), sem matar o modelo híbrido.

### Bônus — P-02: mais cofres, não mais mints

`MAX_MINTS = 4` está no layout de bytes com teste de retrato (`tests/layout.rs`); mexer nisso antes do congelamento é mudança de núcleo, e depois exige migração. A ambição multi-token se resolve com **mais tesourarias** — o organograma já torna tesouraria barata: um cofre por família de token, ou por agente. Custo de contrato: zero.

---

## 7. Por que a soma dos três braços vende

Cada braço sozinho tem uma objeção que o mata, e cada um responde a objeção fatal de outro:

- **Braço 1 sozinho** morre em *"por que não usar só o Allowances nativo com o Squads?"* → responde o **braço 2**: o Allowances limita **gasto**; ninguém limita **ação com conservação de valor**.
- **Braço 2 sozinho** morre em *"quem é o comprador e como você chega nele?"*, competindo com Brahma/Giza/Almanak que têm anos e bilhões em EVM → responde o **braço 3**: porta de entrada, distribuição e um comprador com rosto.
- **Braço 3 sozinho** morre em *"por que eu instalaria o agente de um estranho para mexer no meu dinheiro?"* → responde o **braço 1**: porque o pior caso é limitado e verificável na blockchain em dez segundos.

E o fecho: `product-strategy.md` §6.5 identifica **track record verificável** (alocação com selo temporal + saldo devolvido + cadeia de hash = curva de P&L auditável por terceiro) como a única linha do projeto com efeito de rede, e aponta **marketplaces de agentes** como o comprador que hoje não tem como provar performance de agente nenhum. É exatamente o que o Lucas está construindo. Ou seja: **a vitrine dele não existe sem o nosso track record, e o nosso track record não tem efeito de rede sem a vitrine dele.**

Frase do pitch, já presente nos dois documentos: *a Solana entregou o primitivo; nós entregamos o que falta para alguém confiar um agente de terceiro com dinheiro de verdade.*

---

## 8. Resumo dos braços, com o repo dele absorvido

| | **Braço 1 — Rails** | **Braço 2 — Mandate** | **Braço 3 — Superfície** (repo do Lucas) |
|---|---|---|---|
| **O quê** | Alocação e prestação de contas: cofre, política, sessão, cadeia de auditoria | Envelope de perda provado on-chain: `begin`/`end`, invariantes de estado, retorno mínimo, teto de exposição | Manifesto → instalação → console → vitrine |
| **Como** | 23 instruções, custódia por PDA, limites só mais restritos na descida da hierarquia, idempotência por recibo | Programa **separado**, governado por multisig com timelock, CPI só para programa da allowlist do dono, verificação sobre contas derivadas pelo próprio programa | Plano de controle fechado + execução na máquina do cliente + duas fontes (sink JSONL e RPC) |
| **Por quê** | Sem limite verificável por terceiro, nada em cima é crível | Transferência ≠ troca: quando o dinheiro sai e algo volta, limite de valor não protege nada. É a peça que não existe no mercado | Sem ela a garantia não é operável nem observável — e é a única linha com efeito de rede |
| **Para quem** | Dev solo (aquisição), empresa com agentes (receita) | Quem **aloca capital**: mesa, DAO, fundo pequeno, marketplaces de agentes | Autor de agente (publica), cliente (instala), operador (vários cofres) |
| **Cobra** | Nada. É a âncora de credibilidade | bps sobre capital sob mandato, nascendo em zero + fee opcional de gestor terceiro | Assinatura e listagem |
| **Postura** | Apache-2.0, congelado, auditado | Program id próprio, ADRs próprias, auditoria própria, **não herda** a postura do Rails | Fechado, hospedado |

---

## 9. Repos de terceiros que eles avaliaram

Relevante aqui porque define o que pode e o que não pode encostar no produto.

| Repo | Licença | Papel |
|---|---|---|
| pixel-agents-hq/pixel-agents (9,3k★) | MIT | **fork** — base do front; fronteira `HookProvider` faz de uma fonte nova só uma subpasta |
| Agentshire, age-of-agents, Agent-Quest | MIT (age-of-agents: "Other" no GitHub apesar do texto MIT) | ideias e trechos, com aviso preservado |
| TraderAlice/OpenAlice (7k★) | AGPL-3.0 | **integração por fora, nunca código** — é o cliente natural; copiar obrigaria a abrir o produto |
| Open-Dev-Society/OpenStock (14,4k★) | AGPL-3.0 | referência de tela apenas |
| nautechsystems/nautilus_trader (29k★) | LGPL-3.0 + CLA | fora do hackathon; depois, valida template de estratégia contra histórico |
| awesome-systematic-trading (14,3k★) | sem licença | leitura e pesquisa, nunca cópia |
| Catálogos x402 (Bazaar/Coinbase, x402-list, x402catalog, gold-402) | abertos | descoberta de serviço pago pelo agente |

**Registro do session-log deles, que vale manter visível:** em 17/09 houve intenção manifestada de ignorar licenças de terceiros por pressão de mercado; a assistência de IA recusou produzir código em violação e o caminho legal foi mantido, porque entrega o mesmo produto — o que de fato se queria copiar é MIT (R-07).

---

## 10. Ações deste lado, antes da integração oficial

1. **Commitar `org_chart.rs`.** É a demo mais forte do projeto e o submódulo dele não a enxerga. Custo zero, maior ganho isolado da lista.
2. **Responder P-06 com "programa separado"**, registrado em ADR — e não como preferência, como consequência da regra de direção de dependência.
3. **Responder P-02 com "mais cofres, não mais mints"**, encerrando o R-01 sem tocar no layout.
4. **Levar a variante de fee de gestor terceiro** como resposta ao P-03/R-06.
5. **ADR-016** registrando a mudança de premissa de licença/postura e a fronteira entre os programas — antes de qualquer README público prometer congelamento. ADRs aqui são imutáveis: supersede a ADR-011 na cláusula de licença, não editar.
6. **CLA/cessão**, que continua sendo o único item cujo custo salta de zero para alto num evento único — e agora com um sócio de produto a mais no desenho.
7. **P-01 com três nomes, três posturas.** Não deixar o nome do produto cobrir o programa congelado (`product-strategy.md` §4: marca compartilhada é decisão irreversível antes do lançamento do braço 2).
8. **Alinhar `HACKATHON.md` (deles) com `crypto-worlds-fair-playbook.md` §9–§11** — o documento deles já pede isso por escrito.

---

## 11. Como manter este documento

É um levantamento do lado de fora, com data. O repo deles muda; este arquivo não se atualiza sozinho. Para revisar:

```bash
gh repo clone lglucas/algumacoisa-agentica /tmp/aca -- --depth=1
```

Quando a integração for oficializada, o que for acordado vira **ADR aqui** e some deste arquivo — o dossiê registra o que foi encontrado em 17/09, não o que ficou combinado.
