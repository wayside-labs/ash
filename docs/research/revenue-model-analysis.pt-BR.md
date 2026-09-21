# Agent Rails — Análise de Geração de Receita

> Tradução de `revenue-model-analysis.md` (2026-09-17). Em caso de divergência, o original em inglês é a versão de referência.

**Data:** 2026-09-17 · regenerado contra a árvore atual; supersede a versão de 2026-09-14 deste arquivo
**Estado do repo:** `main` @ `17c36aa` · 81 commits · 1 contribuidor · primeiro commit em 2026-09-08 · 23 instruções · 15 ADRs · CI no ar · sem auditoria, sem deploy, sem usuários
**Insumos:** `ARCHITECTURE.md`, `docs/adr/ADR-001..015`, `docs/spec/accounts-and-instructions.md`, `.github/workflows/`, `packages/cli/`, `programs/agent_rails/tests/org_chart.rs`, `LICENSE` (Apache-2.0), código do programa. Âncoras de mercado citadas na §6; achados competitivos de `docs/research/colosseum-copilot-competitive-landscape.md`.
**Escopo:** só análise. Nenhum código alterado.

---

## 0. O que mudou desde 2026-09-14, e o que isso desloca

Três dias, 73 commits. Não é uma atualização cosmética — quatro das mudanças deslocam a análise, e uma delas cria uma linha de receita que não existia na versão anterior.

| Mudança | Fonte | O que desloca |
|---|---|---|
| **A CI existe e aplica quase toda a ADR-008** — cobertura (política ≥95%, SDK ≥85%), provas Kani, `cargo-mutants` com zero sobreviventes tolerados, E2E no Surfpool, cargo-deny, gitleaks, semgrep | ADR-015, `.github/workflows/` | §5.8. A versão anterior chamava CI verde de "a credibilidade mais barata que dá para comprar" e registrava que não havia nenhuma. Está comprada. A candidatura a grant ficou materialmente mais forte |
| **`FundingMode::NativeAllowance`** — o dono pode manter os fundos na própria carteira sob uma delegação imposta pelo programa, em vez de pré-financiar um cofre | ADR-014 | §1 e §2. Existe agora um caminho de liquidação em que *nenhum dinheiro é escrow em lugar nenhum*, e o Agent Rails compõe com o programa da própria Solana Foundation, não só com o SPL Token |
| **Ids de intenção derivados e `reference` obrigatória** em todo pagamento | ADR-012 | Nova §5.3. Todo pagamento agora carrega o nome que o chamador dá ao que está liquidando. Isso é um razão contábil caindo de uma decisão anti-pagamento-duplicado |
| **O organograma já funciona hoje, sem instrução nova** — uma tesouraria pode pagar o cofre de outra, logo departamentos, orçamento por agente e cadeia de auditoria por nível são um layout de contas, não uma funcionalidade | `tests/org_chart.rs` (passando; hoje fora do versionamento) | Nova §5.3, e uma limitação declarada na §5.1 — o pause **não** cascateia |
| **Posturas de segurança: três presets, overrides por campo, seis garantias inalcançáveis** | ADR-013 | §5.6. O ponto de extensão `PolicyHook` agora tem forma declarada, serializável e validada por Zod para receber dado |
| **`agent-rails init` entregue** — de carteira vazia a pagamento guardado em um comando | `packages/cli/`, PR #15 | §5.10. O topo do funil é real, não planejado |
| **A Solana lançou o programa nativo e auditado Subscriptions & Allowances** | pesquisa de cenário competitivo | §1. "Limitar quanto um delegado gasta" virou primitivo nativo, gratuito e já integrado a Squads/Swig. Deixou de ser algo pelo que alguém pague, de quem quer que seja |

**Uma correção a carregar adiante.** A versão anterior recomendava registrar a decisão de não cobrar taxa de protocolo como "ADR-012". As ADRs 012 a 015 foram escritas para outras coisas nesse intervalo, e **a decisão sobre a taxa nunca foi registrada**. Ela agora é a ADR-016, continua não escrita, e a §3 continua argumentando que é a única decisão com prazo real.

**O que não mudou, e agora é a história inteira:** não há `packages/indexer`, não há deploy em devnet, não há `GOVERNANCE.md` / `SECURITY.md` / `THREAT_MODEL.md`, não há auditoria, não há usuários, e não há uma única decisão relevante para receita registrada. Todo produto pago abaixo fica atrás do indexer; o indexer e a auditoria ficam atrás de dinheiro; o dinheiro é a §5.8.

---

## 1. O enquadramento que decide tudo

O enquadramento da versão anterior era: o dinheiro passa por uma PDA que o cliente possui, nós nunca o tocamos, logo não existe pedágio nessa estrada por construção. Continua verdadeiro, e a ADR-014 tornou isso *ainda mais* verdadeiro — sob `NativeAllowance` os fundos nunca entram numa conta do Agent Rails. Eles ficam na ATA do próprio dono e o programa saca contra uma delegação cujo delegatee é a Treasury PDA. Existe agora uma configuração suportada em que o Agent Rails não segura um lamport por um microssegundo.

O que mudou por baixo do enquadramento foi o piso competitivo. A Solana lançou **Subscriptions & Allowances** — nativo, em mainnet, auditado por Cantina/Spearbit, testado em integração com Squads e Swig. Ele implementa "um delegado pode sacar até um teto, opcionalmente com prazo, revogável" e é gratuito. A ADR-014 adota a postura correta diante disso: *compor, não competir*. Mas a consequência comercial precisa ser dita sem rodeio:

> **Limitar gasto de agente virou commodity. Era a funcionalidade; nunca pode ser o produto.**

Então a pergunta ficou mais afiada. Não é "qual é o ativo monetizável quando o ativo é uma garantia?", e sim: **o que sobra monetizável quando o primitivo embaixo da garantia é gratuito, auditado e nativo?**

A resposta é a camada que o programa nativo não tem e não dá sinal de crescer: **múltiplos limites simultâneos sob papéis separados, com uma cadeia à prova de adulteração que prova que nada foi omitido.** Um contrato de delegação limita um número. O Agent Rails é a camada de governança e contabilidade por cima — e governança e contabilidade são coisas que organizações compram, enquanto um teto de gasto é algo que elas configuram.

O que rende quatro propriedades vendáveis, não três:

| A garantia precisa ser… | Produto | Por que é defensável |
|---|---|---|
| **Vigiada** | Guardian-as-a-Service — uma chave que só pausa, reagindo a anomalias | O programa *prova* que você não consegue roubar. Nenhum concorrente oferece serviço de segurança com raio de dano comprovadamente zero |
| **Observada** | Indexer hospedado + console — ingestão, `verifyChain`, retenção, alertas | Custo marginal real, ônus operacional real, ninguém quer rodar isso |
| **Contabilizada** | Controladoria de organização de agentes — custo por agente, por cargo, por departamento, rastreado até um id de tarefa | *Nova.* A `reference` obrigatória (ADR-012) e a árvore de tesourarias fazem isso cair do caminho de pagamento com custo zero no programa |
| **Provada** | Atestações de conformidade derivadas da cadeia de hash de auditoria | Só o Agent Rails tem a cadeia. Vendida de orçamento de compliance, não de engenharia |

Tudo o mais abaixo é uma variação dessas quatro, um mecanismo de financiamento, ou uma armadilha.

---

## 2. O que a arquitetura fecha — leia antes de desenhar qualquer modelo

Estas são decisões já registradas. Cada uma mata uma classe de modelo de receita. Três linhas são novas desde a versão anterior.

| Decisão | Fonte | Modelos que ela mata |
|---|---|---|
| **Não-custodial; o cofre é uma PDA do programa; o dono sempre pode sacar, mesmo pausado** | ARCH §3, §5 | Renda de float. Spread de processamento de pagamento. Qualquer modelo "seguramos e clipamos". Além disso: **nenhuma alavanca para forçar pagamento** — você nunca pode reter os fundos de um cliente |
| **`NativeAllowance` — os fundos podem nunca entrar numa conta do Agent Rails** *(nova)* | ADR-014 | O último resíduo de uma história de float. Também significa que uma taxa de protocolo teria de ser cobrada em dois caminhos de liquidação, e o segundo é o programa de outra pessoa |
| **Zero dependências de programas externos — agora condicional** *(emendada)* | ADR-001, emendada pela ADR-014 | Acordos de revenue-share roteados pelo programa continuam mortos no caminho padrão. A ADR-014 é o único precedente de composição com outro programa, e exigiu um argumento de segurança estrutural (`delegatee` = Treasury PDA) para se justificar. Não é um template para parcerias |
| **Apache-2.0 em todo o código, sem CLA** | ADR-011 §4 | Relicenciar este repo. Open-core *dentro* deste repo assim que uma contribuição externa entrar |
| **Autoridade de upgrade → `None` na 1.0.0** | ADR-011 §2 | **Qualquer taxa on-chain acrescentada depois do congelamento.** Ver §3 — esta é a que tem prazo |
| **Superfície do agente sem nenhuma ferramenta de escalada; a postura é escolhida por quem sobe o servidor, nunca pelo agente** | ARCH §3, §10; ADR-013 §9 | Caminhos de upsell que passam pelo agente. O `request_limit_increase` da v1.1 emite um evento off-chain por design |
| **Pause é kill switch, não tranca do dono; guardiões não despausam** | ARCH §3 | "Pausamos sua tesouraria até você pagar" — estruturalmente impossível, e ainda bem |
| **Ids de intenção derivados; uma retentativa endereça o mesmo recibo** *(nova)* | ADR-012 | Reconciliação como produto. Não há pagamentos duplicados para reconciliar. Venda o razão (§5.3), não a limpeza |
| **Seis propriedades são inalcançáveis por qualquer preset (`IMMUTABLE_GUARANTEES`)** *(nova)* | ADR-013 §2 | Um "modo estrito" pago. Os botões perigosos não são botões; os seguros são de graça. Segurança não pode ser uma edição |
| **Sem serviço hospedado nem dashboard na v1** | ARCH §1 não-objetivos | Nada permanentemente; apenas sequencia a receita hospedada para depois da v1 |

**Dois ativos que a arquitetura cria e ninguém mais tem.**

1. **Uma métrica de preço entregue pelo modelo de dados.** Todo cliente publica on-chain, em `MintLimit`, o máximo que aceita perder — `long_window_max` e `lifetime_max`, denominados, legíveis por qualquer um. Sob `NativeAllowance` há um segundo número, mais duro, ao lado: o teto da própria delegação nativa contra uma **carteira operacional viva**. A §6 precifica no primeiro e vende no segundo.
2. **Um razão contábil que ninguém precisou construir.** A `reference` é obrigatória e não tem default (ADR-012 §2), está dentro do preimage do `intent_id` — logo não pode ser omitida nem forjada depois sem mudar qual recibo o pagamento endereça — e `seq`/`audit_head` a ordenam por sessão. Gasto por agente (sessão), por cargo (política), por departamento (tesouraria), por mint, cada linha rastreável até um id de tarefa externo — e a não-omissão é demonstrável. Isso é a §5.3, e não existia três dias atrás.

---

## 3. A primeira decisão irreversível: a taxa de protocolo precisa ser resolvida antes do congelamento

Inalterada no mérito, alterada na urgência e na numeração.

A ADR-011 faseia o programa `0.x` → `1.0.0-beta` → `1.0.0` com autoridade de upgrade `None`. **Depois disso, nenhuma lógica de taxa pode ser acrescentada à v1.** Exigiria um program id 2.x e `migrate_treasury` em toda tesouraria existente — reonboarding da base instalada inteira para cobrar um imposto. Ninguém migra por isso.

**A tensão, dita com clareza.** Uma taxa on-chain exige config global mutável (bps da taxa, destino da taxa) com uma autoridade para defini-la. Essa autoridade é *exatamente o super-owner que o congelamento existe para eliminar*. Não dá para entregar ao mesmo tempo "Imutável. Verifique com `solana program show`" e "podemos mudar a taxa". As alternativas são piores:

- **Taxa e destino imutáveis, hard-coded na 1.0.0.** Honesto e verificável, mas precifica a adoção no momento em que você não tem nenhuma, é removível em uma linha num fork (Apache-2.0), e transforma uma ferramenta de segurança em ferramenta de extração de valor no primeiro parágrafo do README. Contra um *primitivo nativo gratuito* (§1), é também simplesmente não competitivo.
- **Campos de taxa reservados, porém inertes.** Bytes reservados deixam *dado* entrar sem migração — a ADR-014 acabou de provar, reclamando um byte de `MintConfig._pad[6]` sem migrar conta nenhuma. Mas código congelado não age sobre dado novo. Reservar não compra nada pós-congelamento.
- **Taxa só no caminho `NativeAllowance`.** Pior que as duas: a transferência é um CPI para um programa que você não controla, sobre fundos que nunca entram nas suas contas, e a taxa seria trivialmente evitada escolhendo o outro modo de funding.

**Recomendação: nenhuma taxa de protocolo na v1 — e registrar isso como ADR-016, com este raciocínio.** A imutabilidade *é* o produto; adoção é o único insumo de todo modelo da §5; e o primitivo abaixo de você é gratuito. Um programa congelado, sem taxa e forkável é a resposta certa.

Duas coisas mudaram sobre o prazo desde a versão anterior, e apontam em direções opostas:

- **Ele está mais longe do que parecia.** A ADR-015 adia o hash de build verificável e o smoke em devnet para um workflow de release que não existe, nenhuma tag foi publicada, e o programa não está deployado em devnet — o deploy exige **7,10 SOL** só de programdata contra os **5 SOL** que a chave de CI tem. O congelamento está a vários marcos de distância.
- **O que é exatamente por que deve ser escrita agora.** A decisão custa uma hora hoje e fica indisponível para sempre depois do congelamento. A versão anterior recomendou isso em 2026-09-14; três dias e quatro ADRs depois ela continua sem registro, e o número de ADR que ela ia ocupar se foi. É esse o modo de falha que esta linha existe para evitar.

Se quiser preservar opcionalidade: a versão honesta é uma taxa na **2.x**, introduzida abertamente como o preço da próxima geração de funcionalidades, com a 1.x gratuita e suportada para sempre. Isso é uma estratégia de verdade e não custa nada manter aberta hoje.

---

## 4. A segunda decisão irreversível: onde mora o código enterprise — agora acoplada a abrir o repositório

A ADR-011 escolheu **Apache-2.0, DCO, sem CLA**. Você continua sendo o único contribuidor nos 81 commits, então ainda detém tudo e poderia relicenciar à vontade. **No momento em que o PR de um terceiro entrar, isso acaba** — sem CLA não há direito de relicenciar a contribuição dele, e este repo é Apache-2.0 para sempre.

Portanto: **se algum dia houver uma edição comercial, ela precisa morar num repositório separado desde o dia um**, sob licença separada, importando `@agent-rails/*` como dependência. Refazer depois é impossível.

```
agent-rails/            Apache-2.0, para sempre, sem exceção
  programa, crate de política, client, sdk, mcp, contract, cli, adapters, core do indexer
    → a coisa que as pessoas auditam, forkam e confiam

agent-rails-cloud/      proprietário ou BUSL-1.1, repo separado, privado ou source-available
  serviço de guardião, indexer hospedado + console, controladoria, exports de conformidade,
  signer gerenciado, SSO/RBAC, pacotes de política
    → a coisa pela qual as pessoas pagam
```

Nada proprietário pertence ao caminho de pagamento nem ao caminho de imposição. A linha divisória: *se pode recusar um pagamento, é Apache-2.0.*

**O que é novo: essa decisão agora tem data-gatilho, e o gatilho é uma decisão para a qual você já está sendo empurrado.** A ADR-015 registra que o CodeQL é indisponível porque o repositório é privado, e que fica gratuito se o repositório se tornar público. Várias outras coisas querem a mesma abertura — avaliadores de grant lendo o conjunto de ADRs (§5.8), auditores, e o pitch inteiro de "verifique você mesmo". Abrir provavelmente é o certo. **Abrir é também o que convida o primeiro PR externo.** As duas decisões são a mesma decisão, tomada na ordem errada se tomada sem cuidado.

**Ação, barata, hoje:** registrar a separação antes de tornar o repositório público, e anotá-la em `GOVERNANCE.md` — ainda planejado, ainda não escrito, e pré-requisito tanto do grant quanto da auditoria, junto de `SECURITY.md` e `THREAT_MODEL.md`.

---

## 5. Opções de receita, ranqueadas

Ranqueadas por (encaixe com a arquitetura) × (defensabilidade) ÷ (esforço para um mantenedor solo). Dez linhas; duas são novas desde a versão anterior.

### 5.1 ★★★ Guardian-as-a-Service — ainda o melhor encaixe

**O que é.** O cliente coloca sua pubkey em um dos cinco slots de guardião. Você monitora o stream de eventos dele e chama `pause` quando algo parece errado: velocidade de gasto subindo em direção ao `short_window_max`, rajada de recusas, sessão pagando destino nunca visto, agente batendo repetidamente no `per_tx_max`, atividade fora do horário comercial declarado.

**Por que é a ideia mais forte daqui.** Serviço de segurança tem um problema de confiança: para te proteger preciso de acesso, e acesso é risco. O programa já resolveu isso. Um guardião pode chamar exatamente uma instrução, não pode despausar, não pode sacar, não pode configurar, não pode tocar numa política ou numa sessão, e pode ser removido pelo dono unilateralmente sem cooperação sua. **O pior que um guardião Agent Rails totalmente comprometido faz é desligar o agente do cliente** — e isso é checável on-chain em dez segundos, não afirmado num PDF de trust center.

**O que o `NativeAllowance` muda.** Aumenta o valor. Sob `IsolatedVault` o raio de dano é o que o dono escolheu escrow; sob `NativeAllowance` a delegação é contra a **carteira operacional viva** do dono, limitada pelo teto do programa nativo e pela política do Agent Rails. O dono que escolheu eficiência de capital comprou uma superfície maior para ser vigiada, e vigiá-la é o que você vende.

**Uma limitação a declarar antes de vender, não depois.** O pause tem escopo de uma tesouraria. O `org_chart.rs` afirma isso deliberadamente como resultado negativo: **pausar a tesouraria pai não pausa as filhas.** Um contrato de guardião sobre uma árvore organizacional precisa, portanto, de uma chave em cada tesouraria que se espera parar, e o runbook de incidente tem de dizer isso. Pause em cascata é a única funcionalidade de hierarquia que vale a pena acrescentar (candidata a v1.1; ver `agent-orgs-and-defi-mandates.md` §2.4) e, enquanto não existir, cobertura multi-tesouraria é um item de escopo real — o que também é motivo legítimo para o plano multi-tesouraria custar mais.

**Esforço.** Moderado, e reaproveita trabalho já devido: o stream de eventos, o `verifyChain` e os alertas são todos `@agent-rails/indexer`, que já está no plano da v1. O serviço é um motor de regras, uma chave quente e um pager.

**Riscos.** (a) Um falso positivo é outage de produção do cliente — o SLA tem de ser sobre *detecção*, nunca sobre "não vamos pausar errado"; entregue modo dry-run e faça dele o padrão. (b) Guardião afobado é vetor de DoS; imponha rate limit a si mesmo. (c) Você segura uma chave quente com capacidade real, ainda que limitada — aplique a disciplina que a documentação exige dos clientes.

Precificação na §6.2.

### 5.2 ★★★ Indexer hospedado + console — agora o caminho crítico

**O que é.** O `@agent-rails/indexer` está especificado como `EventSource` plugável (polling, Yellowstone) → `Sink` (SQLite, Postgres) com `verifyChain`. Publique em Apache-2.0 para qualquer um auto-hospedar; venda o hospedado: ingestão gerenciada, retenção além do que o gPA responde, `list_payments` / `get_payment_status` sustentando a MCP, console read-only, alertas, export CSV/JSON.

**Por que encaixa.** Custo marginal real (Yellowstone/Geyser e retenção são caros de verdade, o que torna o preço defensável em vez de rent-seeking); zero risco de custódia (lê dado público da chain); e o contrato MCP degrada honestamente sem ele — `list_payments` está documentado como degradando para "unavailable" e *ainda não está implementado* (ARCH §10), então o caminho grátis continua verdadeiro e o caminho pago é um upgrade real, não um sequestro.

**Por que é o segundo em valor e o primeiro em ordem.** É mais próximo de commodity — Helius e Triton vendem indexação; a diferenciação é entender `AgentRailsEvent` e rodar `verifyChain`. Mas **nada mais neste documento sai sem ele**: a §5.1 precisa do stream de eventos, a §5.3 precisa da agregação, a §5.4 precisa da retenção. É uma construção só embaixo de três produtos, `packages/indexer` ainda não existe, e isso faz dele o item de engenharia de maior alavancagem do repositório.

### 5.3 ★★★ Controladoria de organização de agentes — a linha que não existia três dias atrás

**O que é.** FinOps para organizações de agentes: custo por agente, por cargo, por departamento; todo pagamento rastreado até um id de tarefa externo; consolidado sobre uma árvore de tesourarias; exportável para o que o financeiro já usa.

**Por que ficou disponível de repente.** Duas decisões tomadas por outros motivos colidiram:

- **A ADR-012 tornou a `reference` obrigatória e sem default.** Ela é o nome que o chamador dá ao que está sendo liquidado — número de nota, hash de documento, id de tarefa — e está dentro do preimage do `intent_id`, logo não pode ser omitida nem forjada depois sem mudar qual recibo o pagamento endereça.
- **O `org_chart.rs` (passando) provou que a hierarquia não precisa de instrução nova.** O `destination_owner` é um `UncheckedAccount` que o programa nunca lê, e o cofre de uma tesouraria é a ATA comum da própria PDA dela — então cadastrar na allowlist a PDA de uma tesouraria-filha faz o pagamento cair exatamente no cofre dessa filha, onde é gasto sob o teto, a política, os contadores e a cadeia de auditoria dela. O organograma é um layout de contas.

Juntando: **toda dimensão que um controller pediria já está sendo escrita on-chain pelo caminho de pagamento.** Sessão é o agente, política é o cargo, tesouraria é o departamento, `reference` é o objeto de custo, e `seq`/`audit_head` tornam o razão não-omitível. O indexer agrega; o programa gerou o dado de graça.

**Por que vende.** É comprado pela mesma pessoa que compra a §5.4 — financeiro, não engenharia — mas é comprado *antes*, porque alocação de custo é necessidade mensal e auditoria é anual. É também a única linha aqui que fica mais valiosa quanto mais agentes o cliente roda, que é a direção para onde o mercado vai.

**Lacunas honestas.** Nada on-chain sabe que uma tesouraria é filha de outra (não há vínculo `parent` — barato, cabe em bytes reservados), tetos não propagam, e o pause não cascateia. Hoje a consolidação é um join do indexer sobre uma convenção, o que é suficiente para um produto e não deve ser vendido como garantia on-chain.

Precificação na §6.4.

### 5.4 ★★ Conformidade e atestações de auditoria

**O que é.** Transformar o `audit_head` num artefato que a função financeira ou de auditoria paga: um relatório periódico, assinado, verificável de forma independente, de que *todo pagamento que este agente fez no 3º trimestre esteve dentro da política declarada, e aqui está a cadeia de hash provando que nenhum foi omitido.*

**Por que só você pode vender.** A cadeia por sessão (`seq`, `audit_head = sha256(DOMAIN ‖ prev_head ‖ seq ‖ intent_id ‖ mint ‖ destination_owner ‖ amount ‖ slot)`, ADR-006) torna a *omissão* detectável, não só a alteração. Um concorrente com log off-chain prova que registros não foram editados; não prova que nenhum foi apagado. Essa distinção é o valor inteiro de um artefato de auditoria.

**O que ficou vendável junto.** O próprio registro de engenharia agora é evidência: provas Kani das quatro propriedades da ADR-008 mais duas que a ADR não nomeou, um gate de mutation testing com zero sobreviventes tolerados, cobertura medida (99,2% da política, 89,4% do SDK), um teste de snapshot do layout de bytes, e `IMMUTABLE_GUARANTEES` nomeando as seis propriedades que configuração nenhuma alcança. Um auditor que pergunta "como vocês sabem que a aritmética de limites está certa" agora tem uma resposta em formato de documento. Vale montar isso dentro do pacote de atestação em vez de deixar nos logs de CI.

**O que vender.** Relatórios de atestação agendados; retenção além do praticável on-chain; uma ferramenta verificadora de terceiros (Apache-2.0 — dê o verificador de graça, ele *aumenta* o valor da atestação); evidência de screening de destino (§5.6) anexada a cada período; formatos que um auditor reconhece.

**Comprador.** Não é o dev. É financeiro, risco ou compliance — orçamento diferente, disposição a pagar muito maior, e renovação guiada pelo calendário de auditoria, não pelo entusiasmo da engenharia.

**Pré-requisito.** Só vende para empresa grande o bastante para ter função de auditoria. Projete agora; venda no ano dois.

### 5.5 ★★ Track record verificável de agente — anote, não construa

A cadeia de uma sessão é um registro com selo temporal do que um agente teve permissão de gastar e do que de fato gastou, e é verificável por terceiros sem confiar em quem publica. É matéria-prima de **reputação de agentes** — para marketplaces, para quem aloca capital em estratégias de agente, e como camada de descoberta.

É mercado de dois lados e depende inteiramente de adoção prévia, então é uma anotação, não um plano. Vale uma frase num pitch e zero horas de engenharia em 2026.

### 5.6 ★★ Pacotes de política e screening de destino — conteúdo por assinatura

**O que é.** A interface `PolicyHook` do SDK é um ponto de extensão sem nada entregue dentro. Encha com *dado mantido*, que é o único tipo de software que recorre legitimamente: listas de endereços sancionados e de alto risco; feeds de drainers conhecidos; classificação de risco de mint (honeypots, freeze authority viva, extensões surpresa); pacotes de regras curados para as formas comuns — só horário comercial, orçamento por fornecedor, pagamento casado com nota.

**Por que funciona melhor do que funcionava.** A ADR-013 deu forma declarada à postura: presets mais overrides por campo, serializados em `@agent-rails/contract`, validados pelo mesmo schema Zod que os documenta, parseados na construção para que um typo seja falha de inicialização. Uma assinatura agora entrega *um fragmento de postura e um feed*, dentro de um slot que existe, com teste de snapshot em volta — em vez de entregar dentro de uma interface sem nenhuma implementação.

**Por que sobrevive a fork.** A interface é grátis e aberta; o feed é assinatura. É o padrão ClamAV/Snyk/registry do Semgrep: o fork leva o código, não as atualizações.

**Ressalva obrigatória na documentação.** Políticas soft explicitamente *não são* a garantia (ARCH §6, README). O resultado de quatro estados (`match / possible / no_match / **unavailable**`) é obrigatório para que queda de feed jamais leia como "permitido" — e a ADR-013 já nomeia o botão correspondente, `hooks.onUnavailable`, com os limites on-chain como backstop. Venda como defesa em profundidade, nunca como imposição.

### 5.7 ★ Relayer — e pule o managed signing

- **Relayer (v1.1).** No modo signed-intent o agente assina a intenção off-chain e um relayer submete `[Ed25519Program.verify, execute_payment]`. O `fee_payer` já é conta separada da `session_key` exatamente para que o patrocínio funcione. Cobre gas mais margem, medido por transação. Pequeno, custo unitário óbvio, e ninguém mais vai construir um que entenda `PaymentIntent`.
- **Managed signing: pule.** Turnkey, Privy, Dfns e Fireblocks já vendem isso, e a ARCH §9 deliberadamente faz qualquer signer compatível com Kit funcionar sem cola — o que é certo para os usuários e significa competir no território deles sem o aparato de compliance deles.

### 5.8 ★★★ Grants — ainda a jogada *inicial* correta, e a candidatura está materialmente mais forte

A ADR-011 orça a auditoria profissional em **$30–80k** e nomeia grants da Solana Foundation / Superteam como o caminho de financiamento. Para um projeto solo isso continua sendo a ação de maior valor esperado do documento, e as razões não mudaram: é não-dilutivo; não exige clientes, product-market fit nem infraestrutura hospedada; **financia a auditoria, e a auditoria é o portão de todas as outras linhas aqui** — ninguém roteia tesouraria real por um programa não auditado.

**O que está mais forte do que três dias atrás:**

| Então (2026-09-14) | Agora |
|---|---|
| Nenhuma CI | Cinco workflows; cobertura, Kani, mutants, E2E, cadeia de suprimentos, segredos, SAST — todos gateando |
| 11 ADRs | 15, incluindo uma que nomeia os próprios gates adiados em vez de superestimar o que roda (ADR-015) |
| CLI `init` planejada | Entregue: carteira vazia → pagamento guardado em um comando |
| Composição com o programa nativo da Foundation: não era história | ADR-014, verificada contra o binário real de devnet, incluindo o ataque que prova que a escolha do delegatee é estrutural |

Essa última linha merece uma frase própria numa candidatura. A Foundation lançou Subscriptions & Allowances nesta janela; **o Agent Rails agora é uma camada de governança que compõe com ele e prova que a composição é segura contra o binário real deployado.** Isso é uma narrativa de grant muito melhor do que "uma alternativa a algo que a Foundation acabou de lançar".

**O único bloqueio barato.** Ainda não há deploy em devnet, e a ADR-015 mediu por quê: **7,10 SOL** de aluguel de programdata contra **5 SOL** na chave de CI, e o faucet público impõe rate limit. São mais ou menos 2–3 SOL, mais folga, entre o repositório e o artefato mais forte que uma candidatura pode mostrar. Resolva esta semana.

**O que torna a candidatura forte, em ordem:** um deploy funcionando em devnet; o conjunto de ADRs (quase nenhum candidato tem quinze aceitas); a pirâmide de testes com as lacunas *nomeadas*; CI verde; uma firma de auditoria nomeada com orçamento; e a declaração clara de que o programa será congelado e sem taxa (§3).

### 5.9 ★ Enterprise: implantação, integração, suporte

Retainers de integração, adaptadores customizados, revisão de desenho de política, Slack privado, SLAs de resposta. Margem alta, caixa imediato, zero infraestrutura.

**O problema honesto:** não escala além das suas horas e, com um contribuidor, cada hora vendida atrasa o indexer (§5.2), o que atrasa tudo. Trate consultoria como **oportunista, limitada e estratégica**: aceite engajamentos que produzam cliente de referência ou adaptador reutilizável, recuse o resto. Um arranjo de design partner — integração com desconto ou grátis em troca de estudo de caso público e feedback detalhado — costuma valer mais que o honorário nesta fase.

### 5.10 Jogadas de distribuição que não são receita direta

- **`agent-rails init` — entregue, e o topo do funil.** Cinco instruções na única ordem que funciona, mais o financiamento, a keypair de sessão em disco e o bloco `mcpServers` impresso para o `claude_desktop_config.json`. Tempo até o primeiro pagamento é o topo de todo funil aqui, e agora é mensurável em vez de aspiracional. Instrumente.
- **O adaptador x402.** O x402 processou cerca de 75M de transações e $24M numa janela recente de 30 dias, quase tudo abaixo de $1, sob um guarda-chuva da Linux Foundation cujos membros incluem Google, Visa, AWS, Circle e Anthropic. Ser a camada de política sob esse ecossistema é distribuição, não receita — mas toda tesouraria que isso trouxer é prospect de §5.1, §5.2 e §5.3.
- **Adaptadores de framework** (LangChain, AI SDK, OpenAI Agents) e o pacote PyPI, listados no diretório de ferramentas de cada framework. Ainda não construídos; ainda distribuição gratuita.

### 5.11 Estratégico / aquisição

O desfecho grande mais provável para um primitivo não-custodial de controle de gasto de agente é **aquisição por um adjacente** — Squads, Turnkey, Privy, Dfns, uma carteira, uma plataforma de tesouraria. Cada um tem clientes perguntando "como deixo um agente gastar sem entregar as chaves" e nenhum tem resposta limpa. O que aumenta esse valor *não* é receita: é adoção, auditoria, programa congelado e proveniência Apache-2.0 limpa. A mesma lista de sempre. Otimize o produto; a opção vem de graça.

---

## 6. Precificação — âncoras e escadas

> Nada aqui é vendável antes da auditoria. Estes números decidem a *forma* da cobrança e a ordem de grandeza, não a página de preços da semana que vem.

### 6.1 Âncoras de mercado

| Produto | Preço público | Fonte |
|---|---|---|
| **Squads** | $0 Basic (taxa única de 0,1 SOL) · **$49/mês Pro** · Enterprise sob consulta | docs.squads.so |
| **Helius** (RPC + indexação Solana) | $0 · **$49** · **$499** · **$999**/mês; add-ons de dados $500–$4.500/mês | helius.dev/pricing |
| **Privy** (infra de carteira) | Free · **$299** · **$499**/mês · Enterprise | privy.io/pricing |
| **Turnkey** (assinatura) | **$0,10/assinatura** PAYG · **$99/mês** Pro a $0,05 · Enterprise a $0,0015 | comparativo da Openfort |
| **Gate402 / Metera** (adjacente) | $0 · $29 · $99/mês · custom | pesquisa anterior |
| **Chainalysis** (compliance) | **€120k–€250k/ano** para um CASP médio; implementação $5k–$25k | finconduit |
| **Hypernative** (monitoramento de segurança) | Sem preço público — enterprise. $40M Série B, 200+ clientes | hypernative.io |

**O que as âncoras dizem:** infraestrutura Solana para desenvolvedor vive em **$49–$999/mês**; segurança e compliance de verdade vivem em **cinco a seis dígitos por ano**; cobrança por operação é aceita na casa dos **centavos**.

### 6.2 Guardian-as-a-Service

Cobre sobre o **teto agregado protegido** — o `long_window_max` somado entre os mints configurados. O cliente já publicou esse número on-chain; é a declaração dele do máximo que aceita perder.

| Plano | Preço | Teto protegido | Inclui |
|---|---|---|---|
| **Watch** | **$0** | 1 tesouraria, qualquer teto | Só dry-run (alerta, nunca pausa), alertas por webhook, sem SLA |
| **Guard** | **$149/mês** | até **$10k/dia** | Pause armado, regras padrão, SLA de *detecção* de 15 min, uma chave de guardião |
| **Guard Pro** | **$599/mês** | até **$100k/dia** | Regras customizadas, SLA de detecção de 5 min, chave por ambiente, runbook de incidente |
| **Guard Scale** | **$1.999/mês** | até **$1M/dia** | SLA de 1 min, RPC privado, on-call, revisão trimestral de política |
| **Enterprise** | sob consulta | acima de $1M/dia | Multi-entidade, contrato, suporte dedicado |

$599/mês contra um teto declarado de $100k/dia é $7.188/ano contra uma perda máxima autodeclarada de $100k num único dia — cerca de 7% de um dia de exposição, por um ano inteiro. Contra a Hypernative (enterprise, cinco dígitos) somos a opção acessível; contra o Helius Business ($499) ficamos na mesma faixa de "infraestrutura séria de produção". **Nunca coloque "não vamos pausar errado" num SLA.** O SLA é de detecção; dry-run é o padrão. Cobertura multi-tesouraria é aumento real de escopo (§5.1 — o pause não cascateia) e deve ser precificada como tal.

### 6.3 Indexer hospedado + console

| Plano | Preço | Inclui |
|---|---|---|
| **Free** | **$0** | 1 tesouraria, retenção de 7 dias, `verifyChain` sob demanda, console read-only |
| **Team** | **$149/mês** | 5 tesourarias, 90 dias, alertas, export CSV/JSON, `list_payments` na MCP |
| **Business** | **$599/mês** | Tesourarias ilimitadas, 12 meses, webhooks, SSO, múltiplos usuários |
| **Enterprise** | sob consulta (referência **$1.500–$4.000/mês**) | Retenção multi-ano, Postgres dedicado, VPC, SLA de ingestão |

**Base de custo a verificar antes de publicar:** um plano Helius Business ($499) ou Professional ($999) mais um add-on de dados serve *vários* clientes. Com o Team a $149, a margem bruta fecha por volta de cinco clientes pagantes. Valide com números reais antes de comprometer preço.

### 6.4 Controladoria de organização de agentes

Cobre por **sessão de agente ativa** — a unidade que o cliente entende e a que cresce junto com o valor entregue.

| Plano | Preço | Inclui |
|---|---|---|
| **Free** | **$0** | até 3 sessões ativas, relatório mensal básico |
| **Team** | **$9/agente/mês** (mínimo $49) | Custo por agente/cargo/departamento, rastreio por `reference`, export |
| **Business** | **$599/mês** | Agentes ilimitados, consolidação multi-tesouraria, centros de custo, export contábil, API |
| **Enterprise** | sob consulta | Múltiplas entidades, integração com ERP, campos customizados |

$9/agente é preço de assento de SaaS, familiar para quem aprova orçamento. Cinquenta agentes caem em $450/mês, que é onde o Business a $599 começa a fazer sentido sozinho — a escada sobe por conta própria.

### 6.5 O bundle, que é o produto de verdade

| **Treasury Assurance** | **$999/mês** |
|---|---|
| Guard Pro (até $100k/dia) + Indexer Business + controladoria ilimitada | ~30% de desconto sobre os três avulsos ($1.797) |

Um preço, um contrato, um comprador. Apresente primeiro; os planos avulsos existem para quem quer só uma peça.

### 6.6 Atestações de conformidade, relayer, feeds, serviços

| Item | Preço |
|---|---|
| Atestação trimestral, 1 tesouraria | **$2.500/trimestre** ou **$8.000/ano** |
| Multi-entidade, formato exigido pelo auditor, suporte a due diligence | **$25.000–$60.000/ano** |
| Onboarding da atestação | **$5.000–$15.000**, uma vez |
| Relayer | **$0,002 por transação patrocinada**, piso de $49/mês (a Turnkey cobra $0,05–$0,10 por assinatura — uma ordem de grandeza acima, e uma boa frase de vendas) |
| Feed de screening, Basic (sancionados + drainers, diário) | **$199/mês** |
| Feed de screening, Pro (+ risco de mint, pacotes de regras, histórico, SLA de atualização) | **$499/mês** |
| Design partner (integração + estudo de caso público) | **$5.000–$15.000**, ou grátis em troca do caso, do feedback e da referência |
| Retainer de integração | **$3.000–$8.000/mês**, com teto de horas |
| Revisão de desenho de política | **$2.500** por engajamento |

A Chainalysis a €120k–250k/ano é o teto do orçamento de compliance; um artefato estreito e específico vale 5–20% disso. O verificador continua gratuito e open-source — é ele que torna a atestação crível.

### 6.7 Checagem de realidade

Com **Treasury Assurance a $999/mês**:

| Clientes | MRR | ARR | Significa |
|---|---|---|---|
| 5 | $5.000 | $60.000 | Paga a infraestrutura e um pouco mais |
| 10 | $10.000 | $120.000 | Sustenta uma pessoa em tempo integral |
| 25 | $25.000 | $300.000 | Sustenta um time pequeno |
| 50 | $50.000 | $600.000 | A conversa com investidor muda de tom |

**A pergunta não é qual preço cobrar. É se existem hoje dez empresas alcançáveis que rodam agentes com dinheiro suficiente para justificar $999/mês.** Ninguém verificou isso. Ver §9.

---

## 7. O que não funciona, e por quê

| Ideia | Por quê não |
|---|---|
| **Taxa de protocolo no `execute_payment` (v1)** | Irreconciliável com a alegação de imutabilidade; removível em uma linha num fork; taxa uma adoção que você não tem; e agora não competitiva contra um primitivo nativo gratuito. Ver §3 |
| **Competir com Subscriptions & Allowances em "limitar gasto"** | É nativo, gratuito, auditado por Cantina/Spearbit e já integrado a Squads e Swig. Componha com ele (a ADR-014 compõe); compita em papéis, múltiplos limites, allowlists e cadeia de auditoria, que ele não tem |
| **Assumir custódia / ganhar float** | Destrói a única alegação diferenciadora. Não é um trade-off — é erro de categoria. Sob `NativeAllowance` não existe nem saldo sobre o qual ganhar |
| **Token** | Sem sink. Sem taxa para distribuir, sem papel de staking que a chave de guardião não preencha melhor, sem decisão de governança após o congelamento. Acrescenta passivo regulatório a um produto cujo pitch é "verifique você mesmo". Se for preciso capital: §5.8 primeiro, equity depois |
| **Gatear as ferramentas MCP ou o SDK** | A superfície do agente é a superfície de adoção. Gatear mata o funil de todo modelo da §5 |
| **Vender um "modo estrito"** | O teste de admissão da ADR-013 colocou as propriedades perigosas em `IMMUTABLE_GUARANTEES`, inalcançáveis por qualquer preset. Segurança não é uma edição; os presets são de graça |
| **Cobrar pelo verificador da cadeia de auditoria** | Dê o `verifyChain` de graça. Uma atestação que ninguém pode verificar de forma independente vale menos, não mais |
| **Reter fundos por inadimplência** | Estruturalmente impossível — o saque do dono sempre funciona, mesmo pausado — e seria uma traição ao design se não fosse |
| **Open-core dentro deste repo** | Apache-2.0 sem CLA. Ver §4 — repositório separado, decidido antes do primeiro PR externo e antes de abrir o repositório |
| **Construir execução DeFi** (lending, perps, LP) | Programa diferente com modelo de ameaça diferente, três anos atrás dos incumbentes, e abandona a única alegação defensável. Governe *alocação*, não operação — ver `agent-orgs-and-defi-mandates.md` §3.3 |
| **Dashboard hospedado na v1** | Não-objetivo explícito (ARCH §1). Correto — atrasa a auditoria, e a auditoria é o portão de toda receita |

---

## 8. Sequenciamento para um mantenedor solo

Nove dias de vida, um contribuidor, programa completo com 23 instruções, CI verde, CLI entregue, sem indexer, sem deploy, sem auditoria, sem usuários. A restrição vinculante continua sendo o seu tempo.

**Fase 0 — agora → v1 (sem receita, toda a alavancagem).** Mais curta do que era; as linhas de CI e CLI estão feitas.
1. **Deploy em devnet.** ~2–3 SOL mais folga sobre os 5 SOL da chave de CI. A credibilidade mais barata que sobrou, e pré-requisito de grant.
2. **Construir o `@agent-rails/indexer`, Apache-2.0.** Um substrato só sob §5.1, §5.2 e §5.3. O código de maior alavancagem do repositório.
3. **Escrever `GOVERNANCE.md`, `SECURITY.md`, `THREAT_MODEL.md`.** Os três são pré-requisito de grant e de auditoria; os três continuam não escritos.
4. **Registrar a ADR-016: sem taxa de protocolo na v1** (§3), e a **separação do repositório enterprise** (§4) — antes de o repositório se tornar público.
5. Versionar o `org_chart.rs`. É um teste passando que demonstra o organograma e hoje está fora do versionamento.

**Fase 1 — grant + auditoria (§5.8).** Candidate-se com o deploy em devnet, quinze ADRs, CI verde com as lacunas nomeadas, a história de composição da ADR-014, e um orçamento de auditoria. Isso financia o congelamento. Nada mais começa a sério antes de o programa ser auditado.

**Fase 2 — primeiros produtos pagos (§5.1 + §5.2 + §5.3).** Indexer hospedado, Guardian-as-a-Service e controladoria sobre o mesmo substrato, no repositório separado. O guardião é o diferenciado; a controladoria é a mais comprada; o indexer é o que torna os dois possíveis.

**Fase 3 — expandir (§5.6, §5.7, §5.4).** Feeds de screening quando houver tesourarias suficientes para justificar manter uma lista. O relayer com o modo signed-intent da v1.1. Exports de conformidade quando aparecer o primeiro cliente com função de auditoria — e ele vai pedir antes de você oferecer.

Ao longo de tudo: aceite consultoria só onde ela crie cliente de referência ou adaptador reutilizável (§5.9).

---

## 9. Perguntas em aberto que só você responde

1. **O comprador existe?** Esta é agora a pergunta mais importante do documento e está sem resposta. A varredura do corpus de hackathon não achou nenhum projeto atacando gasto descontrolado de agente diretamente (o mais próximo, Blockpal Smart Delegation, não tem cadeia de auditoria nem separação de papéis), e o mercado adjacente todo é *pagamento entre agentes*, não *governança de gasto do lado do dono*. Ou estamos cedo, ou a dor é menor do que parece. **Cinco conversas com clientes respondem isso e nada mais responde** — e elas deveriam acontecer antes de qualquer coisa da §6 ser publicada.
2. **Por que não compor Solana Allowances + Squads?** Grátis, nativo, auditado, já integrado. A resposta defensável existe — nenhuma sessão com limites simultâneos por transação *e* por janela *e* vitalício, nenhuma allowlist de destino somada à de mint, nenhuma cadeia de auditoria por sessão, nenhum kill switch de guardião separado do dono, nenhuma superfície MCP sem escalada — mas ela precisa estar na primeira tela do README, porque é a primeira pergunta que todo avaliador vai fazer.
3. **Repositório público ou privado?** Abrir destrava o CodeQL, fortalece o grant e combina com o pitch de "verifique você mesmo" — e dispara o relógio da §4. Decida as duas juntas.
4. **Empresa ou bem público?** Assumi "bem público que se financia, com uma opção de empresa". Se for venture-backed, a resposta da §3 sobre taxa merece um argumento em vez de um default — a resposta ainda é provavelmente não.
5. **Quem é o primeiro usuário que você realmente quer?** Um dev solo plugando o Claude numa carteira de devnet e uma fintech dando a um agente um mandato de $50k/dia precisam de produtos, documentação e preços diferentes. A §6 assume que o segundo existe; a §5.10 assume que o primeiro é como você encontra o segundo.
6. **Quanto do seu tempo é vendável?** A §5.9 é o caixa mais rápido e a estratégia mais lenta. O limite certo é um número, não uma vibe.
