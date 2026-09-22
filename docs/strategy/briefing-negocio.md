# Agent Rails — Briefing para negócio

**Para:** quem vai cuidar de mercado, receita, parcerias e narrativa — sem precisar ler código
**Data:** 2026-09-21 · **Status:** vivo · **Lê em:** ~20 minutos
**Fonte:** condensado de `docs/strategy/product-strategy.md` e da análise de receita, em linguagem de produto. Se divergir, o `product-strategy.md` é o documento de estratégia; este é o de estudo.

---

## 1. O que é, em uma frase

Agentes de IA já conseguem pagar sozinhos. O Agent Rails é a camada que decide **quanto eles podem perder** — e **prova** isso para um terceiro, sem o cliente precisar confiar em nós.

A frase de categoria:

> Todo mundo está resolvendo como o agente paga. Nós resolvemos quanto ele pode perder — e provamos.

Limitar gasto, sozinho, já virou commodity: a própria Solana lançou um primitivo nativo, gratuito e auditado, que faz exatamente “um delegado pode gastar até X”. **Isso não é o produto.** O produto é governança e prestação de contas em cima: vários limites ao mesmo tempo, papéis separados, lista de para onde o dinheiro pode ir, e um histórico que não dá para apagar em silêncio.

---

## 2. O problema que o comprador sente

Uma empresa (ou uma pessoa) quer que um agente pague fornecedores, APIs, taxas de rede, talvez opere no mercado. Se ela entregar a chave da tesouraria para o agente, o teto de perda é o saldo inteiro: um prompt malicioso, um loop de retry, uma chave vazada.

Cartão virtual (Visa, Stripe, Nekuda) resolve isso no mundo tradicional. No cripto, a resposta comum ainda é “confia no software” ou “usa um teto simples”. O Agent Rails coloca as regras **na rede**, de um jeito que o dono do dinheiro sempre consegue tirá-lo de volta, sozinho, mesmo se nós, o operador ou o agente sumirem.

---

## 3. Analogia: cartão corporativo com quatro pessoas

Pense num cartão empresarial com tetos, e quatro papéis que não se misturam:

| Papel | O que pode | O que não pode |
|---|---|---|
| **Dono** | Coloca e tira o dinheiro, define o teto máximo, desliga tudo | Não precisa operar o dia a dia |
| **Operador** | Define a política *dentro* do teto do dono (limites menores, para onde pode pagar, por quanto tempo o agente vale) | Não pode subir o próprio teto nem sacar |
| **Guardião** | Só aperta o botão de emergência: pausa o agente | Não saca, não configura, não despausa. O pior que um guardião traidor faz é **desligar o agente do cliente** |
| **Agente** | Paga, se a regra deixar | Nunca autoriza um limite. A chave dele autoriza um pagamento; nunca autoriza um teto |

A regra de ouro, que não se negocia: **ninguém afrouxa o próprio limite.** Cada papel só passa adiante um limite menor ou igual ao que recebeu — e apertar vale no pagamento seguinte, sem redeploy. Se um agente comprometido pudesse pedir “aumenta meu limite”, o produto inteiro seria teatro.

Outra regra de ouro: **o dono sempre consegue tirar o dinheiro, sozinho.** Isso é mais útil do que a palavra “não-custodial”. É o que faz diferença jurídica e de confiança. Nós não seguramos o dinheiro do cliente como um banco; se um dia houver produto hospedado, essa saída unilateral tem de continuar valendo.

---

## 4. Os dois produtos (e um terceiro, depois)

Não é um produto só. São dois braços com posturas diferentes, e um jeito de entrar neles.

### Braço 1 — Rails: alocação e prestação de contas

É o que já existe no repositório.

Não é onde o agente *age*. É onde se decide de quanto ele dispõe, e onde fica a prova. Tesouraria, política, sessão com prazo, pagamento recusado se qualquer regra falhar, histórico encadeado.

Serve para: pagar fornecedor, pagar API, pagar taxa — qualquer saída de dinheiro com teto.

### Braço 2 — Mandate: envelope de perda para operação

Ainda não está construído. É a tese do próximo produto.

Não é “fazer trading com segurança” — nesse jogo, no Ethereum, já existem Brahma, Almanak e Giza, com anos e bilhões de volume. O recorte é outro:

> Um **mandato**: um envelope de perda provado na rede, dentro do qual o agente opera livre.

Eles (os incumbentes) validam a *ação antes* (“pode chamar esta função?”). Nós validaríamos o *resultado depois* (“a perda líquida ficou dentro do envelope?”). Na Solana, se a checagem final falha, a transação inteira desfaz — então isso vira garantia, não relatório.

O comprador deste braço paga mais: quem **aloca capital** (mesa, DAO, fundo pequeno, marketplace de agentes). Disposição a pagar indexada a capital sob mandato, não a assento de software.

O que **nunca** se promete: retorno, “trading seguro”, proteção contra decisão ruim do agente *dentro* do envelope. O produto é perda máxima e prova.

O ativo que só este braço cria: **histórico verificável de performance**. Alocação com data + saldo devolvido + cadeia de prova = curva de resultado que um terceiro confere sem confiar em quem publica. É a única linha do projeto com efeito de rede, e é o que um marketplace de agentes precisa para existir com honestidade.

**Rails nunca depende de Mandate.** Mandate pode usar Rails (o cofre da operação é mais um “filho” no organograma, financiado com teto). Se o programa de mandato quebrar, a perda continua limitada pela política do Rails que o financiou.

### Braço 3 — a porta de entrada (low-code / vitrine)

Não é um terceiro produto paralelo. É a **superfície de entrada** do braço 2: o usuário descreve o que quer (“agentes DeFi com teto diário”) e o sistema materializa tesouraria, limites e mandato.

Há um sócio de produto (Lucas) desenhando o lado de marketplace/vitrine noutro repositório: “permissões de aplicativo, mas para dinheiro”. A pergunta que mata qualquer vitrine — *por que eu instalaria o agente de um estranho para mexer no meu dinheiro?* — só tem resposta com a garantia do Rails por baixo.

---

## 5. Quem compra

Três personas, orçamentos diferentes:

1. **Quem aloca capital** — mesa, DAO, fundo, marketplace de agentes. Compra Mandate. Paga em função do capital sob mandato.
2. **Financeiro / risco / compliance** — controladoria (custo por agente, por departamento, por tarefa) e atestação (“todo pagamento do 3º trimestre esteve dentro da política, e nada foi omitido”). Orçamento de compliance, não de engenharia. Renovação anual.
3. **Quem opera agentes no dia a dia** — precisa de teto, pause de emergência e um console. Entra pelo Rails; pode virar cliente das linhas acima.

O comprador **ainda não foi verificado**. Uma varredura de milhares de projetos de hackathon não achou “gasto descontrolado de agente” como dor frequente. Ou estamos cedo, ou a dor é menor do que parece. **Cinco conversas com quem já coloca dinheiro num agente respondem isso. Nada mais responde.** Esse é o trabalho mais importante de negócio agora — para os dois braços.

A objeção que todo avaliador e investidor vai fazer, na primeira tela:

> Por que não usar o Allowances nativo da Solana + Squads, que é grátis, nativo e já auditado?

A resposta defensável: um teto sozinho não é governança. Não tem vários limites ao mesmo tempo, não tem lista de destinos *mais* lista de moedas, não tem histórico que prova omissão, não tem botão de emergência separado do dono, não tem superfície de agente que não consegue se promover. Isso precisa estar na primeira frase do pitch, não no rodapé.

---

## 6. Como ganhamos dinheiro

Ninguém coloca tesouraria real atrás de um programa **não auditado**. Auditoria profissional está orçada em **US$ 30–80k**. Grants (Solana Foundation / Superteam) são a jogada correta *agora*: não diluem, não exigem cliente, e financiam o portão de todas as outras linhas.

Depois da auditoria, as linhas que encaixam na arquitetura, da mais forte para baixo:

| Linha | O que o cliente compra | Por que encaixa |
|---|---|---|
| **Guardião como serviço** | Nós vigiamos e apertamos o pause se algo parecer errado | O pior que um guardião comprometido faz é desligar o agente. Isso é verificável na rede em dez segundos, não num PDF de “trust center”. Preço pelo **teto protegido**, que o cliente já publicou |
| **Console / indexer hospedado** | Histórico, alertas, retenção, tela. Ninguém quer operar isso | Custo real (infra de dados). É o substrato das outras linhas. Ainda não existe como produto |
| **Controladoria** | Custo por agente, cargo, departamento, tarefa | Cai de graça do caminho de pagamento: cada pagamento já carrega um identificador de “o que isto liquida”. Vende para financeiro, todo mês |
| **Atestação de conformidade** | Relatório periódico: “nada saiu da política, nada foi omitido” | Só nós temos a cadeia que prova omissão, não só alteração. Vende no ano dois, para quem tem função de auditoria |
| **Taxa no Mandate** (braço 2) | Pontos-base sobre capital sob mandato, nascendo em zero | Alinhada (capital sob cuidado), não extrativa. O programa deste braço já precisa poder ser atualizado |
| **Fee de gestor terceiro** | O dono define uma taxa paga a um gestor (autor de agente, mesa) | Vendemos infraestrutura para o modelo **dos outros**. Ficamos fora de “gestão de recursos de terceiros” |

Precificação de referência (ainda **não publicar** — falta validar custo e falar com comprador):

- Guardião: da ordem de **US$ 149 / US$ 599 / US$ 1.499 por mês**, indexado ao teto diário declarado (ex.: US$ 599/mês contra um teto de US$ 100k/dia).
- Console: **US$ 49 / US$ 149 / US$ 599**.
- Controladoria: **US$ 9 por agente / mês**, com plano empresa em US$ 599.

SLA do guardião é sobre **detecção**. Nunca sobre “não vamos pausar errado”. Dry-run (avisar sem pausar) é o padrão. Falso positivo é outage do cliente.

---

## 7. O que não vendemos — e por quê

Estas ideias voltam em toda reunião. Vale ter a recusa pronta:

- **Pedágio em cada pagamento do Rails.** Fácil de remover num clone, taxa uma adoção que ainda não existe, e exige um “super-dono” que o congelamento do programa elimina. No Mandate, taxa faz sentido; no Rails, não.
- **Segurar o dinheiro do cliente e ganhar em cima (custódia / float).** Mata a única alegação diferenciadora e puxa regime de transmissor de valores / VASP na maior parte das jurisdições.
- **Token.** Passivo regulatório num produto cujo pitch é “verifique você mesmo”. Continua não recomendado.
- **Trancar as ferramentas que o agente usa.** A superfície do agente é a superfície de adoção. Cobrar ali mata o funil de tudo.
- **Cobrar pelo verificador do histórico.** Dê de graça. Uma atestação que ninguém pode conferir vale menos, não mais.
- **Reter fundos por inadimplência.** O dono sempre saca. Não dá, e não deve dar.
- **Competir de frente com Brahma / Giza / Almanak em “executar DeFi”.** Eles estão anos à frente, em outra rede. Governamos *alocação*, não operação.
- **Competir com o Allowances nativo em “limitar gasto”.** Compomos com ele. Competimos em governança e prova.

---

## 8. Onde o projeto está, de verdade (setembro 2026)

O que existe:

- O **programa na rede de testes (devnet)** — ainda não é mainnet, ainda não é dinheiro real.
- A **engenharia do Rails está à frente da distribuição por uma margem grande**: regras, papéis, histórico, linha de comando, e agora um **painel web local** (conversa + tesouraria + fluxos), para quem não fala Solana.
- Rigor acima do típico de hackathon (provas formais, testes de mutação, CI). Isso é argumento de venda para auditor e grant; não é argumento de venda para o financeiro, sozinho.

O que **não** existe, e é a história inteira do lado comercial:

- Auditoria profissional
- Mainnet / programa congelado
- Indexer (o motor de dados por trás de guardião, console e controladoria)
- Um único usuário pagante
- Conversas de cliente que validem o comprador

Leitura honesta: **produto técnico na frente, distribuição e verificação de mercado atrás.** O próximo passo de negócio não é mais feature. É gente.

Status público hoje, e que deve continuar honesto: versão `0.x`, sem auditoria, só devnet. Não colocar dinheiro que importa atrás disto.

---

## 9. Quatro coisas que não se pivota barato

Com todas as alavancas soltas (licença, taxa, marca, escopo), o risco deixa de ser rigidez e passa a ser incoerência. Quatro invariantes a defender em qualquer conversa:

1. **O dono sempre tira o dinheiro, sozinho.**
2. **A garantia é conferível por um terceiro, sem confiar em nós.** Onde a regra é imposta (na rede, não no nosso servidor) decide isso; a licença quase não decide.
3. **Ninguém afrouxa o próprio limite.** Cada papel só passa adiante um limite menor ou igual ao que recebeu.
4. **O agente nunca escala privilégio.** O que o modelo de linguagem pede é território hostil.

Fora dessa lista — licença, congelar o programa, taxa, marca, estrutura de empresa — é alavanca. Mas **credibilidade não se pivota duas vezes**: anunciar “será aberto e congelado para sempre” e depois relicenciar é o tipo de reversão que cripto não perdoa. Prometer menos e cumprir é grátis hoje.

Ação jurídica barata e urgente, **antes do primeiro contribuidor externo**: CLA ou cessão de direitos. Sem isso, cada contribuição de terceiro congela a licença daquele pedaço. Hoje o custo é zero (um só contribuidor). Depois, é negociar um a um ou reescrever.

Licença, na prática: o que *recusa um pagamento* (a garantia) pode continuar permissivo — é aí que a verificabilidade é o produto. Console, indexer, motor de risco, vitrine — a camada que observa e cobra — pode ser comercial. A decisão é **por camada**, não global.

Marca: o mesmo nome não deve cobrir “congelado e auditado” e “opera DeFi”. A credibilidade do primeiro pagaria a conta do segundo.

---

## 10. Sequência que o negócio precisa respeitar

1. **Agora:** cinco conversas com quem já roda agente com dinheiro. Grants para financiar a auditoria. CLA antes de abrir o repositório ou aceitar PR. Postura pública combinada (o que prometemos e sustentamos).
2. **Antes de construir o Mandate:** três conversas com quem *alocaria capital de verdade*. Não “acha legal” — quanto, com que envelope, o que precisaria ver.
3. **Não começar o Mandate profundo antes da auditoria do Rails estar financiada.** Dois programas não auditados e um orçamento de auditoria é a pior posição possível: perde-se a credibilidade dos dois braços ao mesmo tempo.
4. **Depois:** indexer + console (substrato), guardião, controladoria. Mandate em camadas, só o que o cliente do passo 2 exigir. Low-code / vitrine em cima dos dois.

Há um dashboard local já no ar — isso é porta de entrada e demo, **não** o produto hospedado vendável. O produto hospedado depende do indexer e da auditoria.

---

## 11. O que o colega de negócio precisa decidir (e o que não precisa)

**Precisa:**

- Existe o comprador? Cinco conversas. Script mínimo: o que o agente paga hoje, quanto pode perder, o que aconteceria se perdesse tudo, o que já tentou (cartão, teto nativo, multisig), quanto pagaria por prova + pause.
- Quem é o primeiro usuário que queremos de verdade: um dev plugando o Claude numa carteira de teste, ou uma mesa com mandato de dezenas de milhares por dia? Documentação, preço e pitch são outros.
- Empresa ou bem público que se financia? Muda taxa, licença e o que se promete no README.
- Repositório público ou privado? Abrir ajuda grant e o pitch “verifique você mesmo”; também dispara o relógio do CLA.
- Qual frase vamos sustener em público. Essa, uma vez publicada, não volta barato.
- Grants: Solana Foundation / Superteam, com o orçamento de auditoria como pedido.

**Não precisa:** ler o programa, as decisões técnicas numeradas, nem o painel de implementação. Se uma reunião exigir detalhe de “como a prova funciona”, a resposta de venda é: *um terceiro confere o histórico na rede, sem a nossa palavra; o relatório de atestação é isso em formato que o auditor reconhece.* O resto é engenharia.

Perguntas que ainda mudam o *desenho* (levar para a mesa, não resolver sozinho):

1. No Mandate, o dinheiro fica em contas que só o nosso programa assina, ou fica com o usuário? Muda garantia e risco regulatório.
2. Um mandato é por agente ou por estratégia (vários agentes no mesmo envelope)? Mesa vai querer o segundo.
3. Somos o programa ou a plataforma? Plataforma exige time, não uma pessoa.

---

## 12. Mini-glossário (as palavras que vão aparecer)

| Ouve | Significa, em negócio |
|---|---|
| **Tesouraria / cofre** | A conta da organização na rede, da qual o agente gasta |
| **Política** | As regras: teto por pagamento, por janela de tempo, na vida toda; para onde pode pagar; em qual moeda |
| **Sessão** | O “crachá temporário” do agente: vale até a data, com aqueles tetos |
| **On-chain** | A regra está na rede, não no nosso servidor. Dá para um terceiro conferir |
| **Devnet / mainnet** | Rede de testes vs. rede real com dinheiro de verdade. Hoje: só testes |
| **Auditoria** | Revisão profissional de segurança do programa. Sem ela, não há cliente sério |
| **Congelar o programa** | Depois da auditoria, ninguém (nem nós) altera o código que guarda o dinheiro. Feature para o Rails; problema para o Mandate, que precisa acompanhar o mercado |
| **Indexer / console** | O “extrato e o painel”: lê a rede, guarda histórico, alerta, exporta |
| **Guardião** | O botão de emergência, operado por nós ou por um terceiro. Só pausa |
| **Allowlist** | Lista do que é permitido (destino, moeda, protocolo) |
| **MCP / SDK** | A tomada na parede pela qual o agente se conecta. Para o pitch: “o agente fala com o Rails do jeito que já fala com outras ferramentas” |
| **x402** | Padrão de pagamento entre agentes e APIs (Coinbase, Cloudflare, Linux Foundation). Distribuição, não receita. Eles resolvem o agente *cobrar*; nós resolvemos o dono *limitar* |
| **Squads** | Multisig da Solana. Complemento: o dono do Rails pode ser uma conta Squads. Não é concorrente direto |
| **CLA** | Contrato que deixa a empresa relicenciar contribuição de terceiro. Precisa existir antes do primeiro contribuidor de fora |

---

## 13. O que ler depois, se quiser profundidade

Nada disto é obrigatório para começar as conversas.

| Arquivo | O que é | Quando abrir |
|---|---|---|
| `docs/strategy/product-strategy.md` | Estratégia completa, ainda com jargão técnico | Quando precisar defender um braço numa reunião |
| `docs/research/revenue-model-analysis.pt-BR.md` | Precificação e linhas de receita, detalhadas | Quando for montar tabela de preço. Cuidado: as §§ 3, 4 e 6 que dependiam da licença foram **substituídas** pelo `product-strategy.md` |
| `docs/research/colosseum-copilot-competitive-landscape.md` | Concorrência (em inglês) | Antes de call com investidor ou grant |
| `README.md` | O que o produto faz, uma página (em inglês) | Encaminhar a técnico, não a cliente final |

Não começar por `ARCHITECTURE.md` nem pela pasta `docs/adr/` — são baseline de engenharia.
