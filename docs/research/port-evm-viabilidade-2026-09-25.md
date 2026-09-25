# Parecer — Viabilidade de portar o Agent Rails para EVM

**Data:** 25 de setembro de 2026
**Árvore analisada:** `main` em `561b7c0`
**Escopo:** o que custaria operar o Agent Rails em redes EVM (Arbitrum, Base, Robinhood Chain), o que do código atravessa a fronteira, o que precisa ser reescrito, e o que muda de natureza em vez de mudar de sintaxe.
**Fontes:** código e testes desta árvore; uma compilação verificada do crate de policy para `wasm32-unknown-unknown`; o corpus [ethskills](https://github.com/austintgriffith/ethskills) para o lado EVM; `docs/research/crypto-worlds-fair-parecer-2026-09-21.md` e `docs/strategy/*` para o enquadramento de produto.

> **Decisão em vigor: não migrar.** Este parecer é registro, não plano de execução. Ele existe para que a pergunta, quando voltar, comece de um inventário medido em vez de uma estimativa nova.

---

## Resumo executivo

**É viável, e não é uma refatoração.** É um port do contrato mais uma camada de abstração de cadeia nos pacotes TypeScript. O programa Anchor não sobrevive em Solidity; o resto do repositório sobrevive melhor do que se esperaria, porque a fronteira que o ADR-008 traçou por motivos de testabilidade acabou sendo a fronteira certa de portabilidade.

Estimativa: **8–12 semanas de engenharia focada até paridade funcional**, sem contar auditoria. Isso confirma, com números, o que a §4 do parecer de 21/09 já classificava como Tier 3 — "exige portar contrato ou bridges; Agent Rails é Solana-specific".

Os três achados que mudam a conversa:

1. **O crate de policy atravessa a fronteira intacto** — verificado, não estimado (§1).
2. **O port *simplifica* mais coisas do que complica.** Rent, derivação de ATA, e o ADR-014 inteiro evaporam (§4).
3. **O risco caro não é o contrato — é o modelo de outcome.** `indeterminate` precisa ser reprojetado, não traduzido (§5.1).

E duas objeções que pesam mais que as técnicas: o calendário do Colosseum e a inversão da tese de mercado (§7).

---

## 1. O fato verificado: o núcleo é portável

`crates/agent-rails-policy` compila limpo para WebAssembly em `no_std`, sem nenhuma dependência de Solana:

```bash
cd crates/agent-rails-policy
cargo build --release --target wasm32-unknown-unknown --no-default-features
#    Finished `release` profile [optimized] target(s) in 11.00s
```

Isso não é uma curiosidade. São **945 linhas de `src` que contêm toda a aritmética de limites, o rollover de janelas de época fixa, a ordem parcial de tetos e a cadeia de hash de auditoria**, mais **1.156 linhas de proptests, provas Kani e vetores de auditoria** que as garantem. É o ativo caro do projeto, e é exatamente a parte que não precisa ser reescrita.

O crate tem uma única dependência opcional (`sha2`), `#![forbid(unsafe_code)]`, `#![deny(clippy::arithmetic_side_effects)]`, e mirrors próprios dos tipos on-chain (`Key = [u8; 32]`). Nada disso foi feito pensando em EVM — foi feito para que a camada 1 da pirâmide de testes rodasse sem SVM. O efeito colateral é que ela roda sem Solana, ponto.

---

## 2. Inventário: o que sobrevive

| Camada | Linhas | Destino |
|---|---:|---|
| `crates/agent-rails-policy` | 2.101 | **100% reutilizável** (§1) |
| `programs/agent_rails` — `src` | 5.337 | **Reescrever** |
| `programs/agent_rails` — `tests` | 8.652 | Reescrever; os *casos* se traduzem, o harness não |
| `packages/contract` | 1.116 | ~85% — só nomenclatura (`mint` → `token`, `Pubkey` → `address`) |
| `packages/client` | 14.439 | **Descartar** — 100% gerado por Codama do IDL; em EVM vira wagmi/viem a partir do ABI |
| `packages/sdk` | 3.638 | ~50% — 24 de 30 arquivos importam `@solana/kit` |
| `packages/mcp` | 4.580 | ~70% — 15 de 37; a superfície de tools e o governor são agnósticos |
| `packages/cli` | 6.633 | ~50% — 31 de 55 |
| `packages/dashboard` | 15.367 | **~95%** — apenas 3 arquivos importam `@solana/kit` |
| `packages/e2e` | 1.015 | Reescrever (Surfpool → Anvil/fork) |

O dashboard quase não sente o port. Isso é consequência direta de `@agent-rails/contract` ser a âncora de compatibilidade que o `CLAUDE.md` raiz descreve: schemas, reason codes e event shapes já vivem num pacote que não conhece a cadeia.

`packages/client` ser descartável inteiro é boa notícia disfarçada de má: são 14 mil linhas, mas nenhuma delas é escrita à mão, e o equivalente EVM também é gerado. O custo é trocar um pipeline de codegen por outro, não reescrever 14 mil linhas.

---

## 3. Duas rotas para o contrato

### Rota A — Solidity

Reescreve as 23 instruções. Perde as provas Kani, os proptests e o `cargo-mutants` **sobre o código que roda em produção**. Ganha auditores disponíveis, Foundry, e compatibilidade com toda EVM.

### Rota B — Arbitrum Stylus (Rust/WASM)

O crate entra verbatim e as provas continuam valendo sobre o binário real — o que é um argumento forte para um produto cuja tese é "o programa é a garantia". Mas **Stylus só existe em Arbitrum e em cadeias Orbit**. Base, Optimism e as ZK rollups não o têm. A rota custa exatamente a portabilidade multi-chain que motiva o port.

### Recomendação: Rota A, com o crate como oráculo diferencial

Contrato em Solidity, e o crate Rust mantido como **modelo de referência para testes diferenciais** no Foundry via FFI: o mesmo vetor entra nos dois, e a divergência falha o CI. Isso preserva o investimento de verificação sem amarrar o produto a uma cadeia, e transforma os proptests existentes em um gate que continua valendo depois do port.

---

## 4. O que o port simplifica

Mais do que a intuição sugere.

**Rent desaparece.** `close_policy`, `close_session`, `close_treasury` e `close_receipt` — quatro instruções e toda a lógica de reclamação de aluguel — evaporam. Some junto a janela conceitual de "receipt fechado mas intent ainda não expirado" que o ADR-004 precisou tratar.

**O ADR-014 colapsa.** As 353 linhas de `native_allowance.rs` mais 162 de `enable_native_allowance.rs`, que derivam e verificam PDAs do programa nativo de Subscriptions & Allowances, viram `safeTransferFrom` com um `approve` do dono — ou ERC-2612 `permit` para aprovação sem gas. O `FundingMode` híbrido continua fazendo sentido conceitualmente; a implementação fica uma ordem de grandeza menor.

**A derivação de ATA some, sem perda de segurança.** O cabeçalho de `execute_payment.rs` explica que derivar a conta de destino a partir de `destination_owner` é "a diferença entre uma allowlist que constrange para onde o dinheiro vai e uma que constrange um rótulo". Em EVM o `to` de um `transfer` **é** o dono — não há conta intermediária, e o ataque de conta sósia não existe. A garantia sobrevive de graça.

**`MAX_MINTS = 4` deixa de ser necessário.** O array fixo existe pelo custo de realloc de conta em Solana. Mappings são baratos; o limite pode virar uma escolha de política em vez de uma restrição de layout.

**O modo signed-intent deixa de ser v1.1.** O ADR-003 registrou a opção C — "signed `PaymentIntent` + relayer com introspecção de precompile Ed25519 (gasless, chain-agnostic intent)" — e congelou o struct para que os SDKs v1 já produzissem esses bytes. Em EVM, EIP-712 com `ecrecover` é idiomático e barato, e resolve de imediato o problema de o agente precisar de ETH para gas. O que em Solana era ambição para a próxima versão, em EVM é a escolha óbvia da primeira.

**`block.timestamp` já é o que o código usa.** Sorte relevante: em Arbitrum Nitro — e portanto também na Robinhood Chain — `block.number` retorna o bloco da L1. O design de janelas de época fixa nunca encostou em número de bloco, então a armadilha mais citada dos rollups passa longe.

---

## 5. O que o port quebra

### 5.1 O modelo de outcome precisa ser reprojetado, não traduzido

Este é o risco caro, e é o único item deste parecer que não tem solução de prateleira.

`packages/contract/src/outcome.ts` descreve a distinção entre `denied` e `indeterminate` como o que transforma um nó RPC lento em pagamento duplicado, porque "negado" se lê como um convite a tentar de novo. É o diferencial técnico do produto e a cena mais forte de qualquer demo.

Em EVM o fenômeno existe, mas é outro. Não há "assinatura que o RPC não encontra mas que pode ter entrado" no mesmo sentido: há mempool público, substituição de transação por nonce, reorg de sequencer, e — em optimistic rollup — soft-finality quase instantânea contra finalidade real de sete dias. Cada um desses produz um estado indeterminado com causas, durações e resoluções diferentes das que o SDK trata hoje. O `packages/e2e` chega a ter um proxy que retém `getSignatureStatuses` para exercitar esse caminho; o equivalente EVM não é um proxy que retém uma chamada, é um conjunto de cenários distintos.

**Orçar isso como tradução é o erro mais provável deste port.**

### 5.2 ERC-20 não é SPL

`transfer` sem retorno consistente (USDT é o caso clássico) exige `SafeERC20`. Tokens fee-on-transfer e rebasing quebram os contadores de gasto lifetime — o análogo direto do gate de extensões Token-2022 do ADR-010, que precisa ser reconstruído com outra lista de perigos. `decimals` passa a ser leitura de contrato, não campo de `MintConfig`.

### 5.3 Imutabilidade contra upgrade

`tests/layout.rs` (458 linhas) e a disciplina de blocos `reserved` existem para a estabilidade de layout de conta do Solana — o que permite que features v1.1 entrem sem migração. Em EVM o equivalente é storage gap de proxy, um modelo diferente com falhas diferentes.

Mais sério: o **ADR-011 precisa ser reescrito**. A trajetória "multisig de upgrade → programa congelado" não tem tradução limpa. Em EVM ou o contrato é imutável desde o deploy, ou é um proxy com governança permanente. Não existe o meio-termo de renunciar à upgrade authority de um programa já publicado mantendo o mesmo endereço e estado.

### 5.4 Gas no lugar de CU

Os baselines de `tests/cu-baselines.txt` não traduzem. Estimativa para `executePayment` em EVM: **~80–120k gas** (contadores em storage warm, transfer ERC-20, evento), o que em Arbitrum dá algo entre **$0,002 e $0,005** por pagamento — barato o bastante para a tese de micropagamento agêntico.

O gate de CI traduz bem, e até melhora: `forge snapshot` cobre o mesmo papel que `scripts/cu-baseline.sh` com ferramenta mais madura. A disciplina do arquivo de baselines — não editar um número à mão para deixar um teste verde — vale igual.

### 5.5 Manter sha256; não trocar por keccak256

Keccak é o idioma da EVM e custa 30 gas contra 60 + 12/word do precompile sha256 em `0x02`. A diferença é irrelevante no total da transação. Trocar invalidaria `tests/audit_vectors.rs`, os domínios `agent-rails/audit/v1` e `agent-rails/intent/v1`, e a compatibilidade do crate. **Manter sha256** é a escolha certa: a portabilidade dos vetores vale mais que o gas.

Decisão associada: `Key = [u8; 32]` contra `address` de 20 bytes. Recomendo manter 32 bytes com padding (`bytes32(uint256(uint160(addr)))`), o que preserva o crate e os vetores intactos.

---

## 6. Cadeias-alvo

### Robinhood Chain: a pior primeira escolha para este produto

Não por ser nova — por contradizer a tese frontalmente.

- L2Beat classifica a cadeia como **Stage 0**: dois validadores de fraud proof whitelisted, exit window "None", sequencer failure "No mechanism".
- **ArbOS 61 permite filtragem de transações**: um filtrador autorizado registra um hash num precompile (`0x…0074`) e a state transition function passa a rejeitá-lo — **inclusive transações forçadas via L1**. Force inclusion não é escape hatch nessa cadeia, ao contrário de Arbitrum One e das demais Orbit.

O README deste repositório afirma que "the program is the guarantee" e que pause é um kill switch do agente, não uma trava do dono — o saque do dono continua funcionando mesmo pausado. Numa cadeia onde um terceiro autorizado pode censurar a transação de saque do dono, essa segunda frase deixa de ser verdadeira. É uma contradição de posicionamento antes de ser um problema técnico.

Somam-se três detalhes concretos: os stock tokens usam `uiMultiplier()` (ERC-8056) — um multiplicador de exibição em que o balance bruto nunca rebasa, exatamente o padrão que desalinha contadores de gasto lifetime se alguém indexar o valor exibido; USDG (Paxos) tem **6 decimais, não 18**; e os tokens não estão disponíveis para pessoas dos EUA, Canadá, Reino Unido, Suíça e EAU.

### Ordem recomendada

1. **Arbitrum One** — liquidez DeFi mais profunda, bytecode-compatible, e Stylus disponível caso a Rota B volte à mesa.
2. **Base** — mais barata (~50% abaixo de Arbitrum/Optimism), ecossistema voltado a agentes de IA, e onde ERC-8004 e x402 têm mais gravidade.

CREATE2 com o mesmo salt dá o mesmo endereço nas duas, o que vale a pena garantir desde o primeiro deploy.

### Um ativo que só existe do lado EVM

**ERC-8004** (registro de identidade e reputação de agentes, em mainnet desde 29/01/2026, mesmo endereço em mais de 20 cadeias) e **x402** encaixam de forma complementar, não concorrente: x402 paga **APIs inbound**, o Agent Rails guarda o **treasury outbound**. O parecer de 21/09 já propunha esse posicionamento como narrativa; em EVM ele deixa de ser narrativa e vira integração demonstrável.

---

## 7. As duas objeções que pesam mais que as técnicas

### 7.1 Calendário

`docs/strategy/colosseum-plano-execucao.md` e o parecer de 21/09 fixam a submissão do Crypto World's Fair em **12 de outubro**. O Colosseum é um hackathon Solana, e há 15 issues P1 abertas — seis delas do épico do dashboard hospedado (ADR-017, issues #31–#37). Um port iniciado agora não entrega EVM a tempo e compromete a submissão que já está encaminhada.

### 7.2 Tese de mercado

`docs/strategy/product-strategy.md:157` é explícito: *"O buraco é geográfico: EVM tem três incumbentes com volume, Solana não tem nenhum, e o executor Solana (Solana Agent Kit) é usado e não tem guardrail nenhum."* Brahma, Almanak e Giza, com anos e bilhões de volume.

Portar para EVM é entrar de frente no mercado que a estratégia deste projeto descreve como ocupado, abandonando o vazio que justifica o projeto existir. Isso não mata o port — mas **inverte o go-to-market**, e o diferencial passaria a precisar ser outro.

Há um candidato defensável: nenhum dos três incumbentes tem política verificada formalmente nem superfície MCP-first com não-escalação asseverada por teste, e o encaixe com ERC-8004 + x402 é muito mais fácil de demonstrar em EVM do que em Solana. Mas isso é uma tese nova, que precisa ser escrita e testada — não um corolário da atual.

---

## 8. Esforço estimado

| Fase | Conteúdo | Estimativa |
|---|---|---|
| 0 | ADR de abstração de cadeia; decisão Rota A/B; redesenho do ADR-011 | 1 semana |
| 1 | Contrato Solidity — 23 instruções viram ~18 funções (4 `close_*` somem, `enable_native_allowance` vira `approve`); ~1.500–2.500 linhas | 3–5 semanas |
| 2 | Paridade de verificação — testes diferenciais Foundry ↔ crate via FFI, invariantes (`limit_leq_ceiling` vira invariant test), Halmos/Certora no lugar das provas Kani | 2–3 semanas |
| 3 | `ChainAdapter` em TS; port de sdk/mcp/cli; contract e dashboard quase intactos | 2–3 semanas |
| 4 | Deploy multi-chain, CREATE2, E2E em fork com Anvil | 1 semana |
| 5 | **Auditoria** — não opcional: o produto inteiro é uma alegação de segurança | fora da estimativa |

**Total até paridade funcional: 8–12 semanas.** A fase 2 é a que mais costuma ser subestimada, e a §5.1 é a que mais costuma estourar.

---

## 9. Se e quando for para frente

Sequência de menor arrependimento:

1. Submeter o Colosseum em 12/10 sem tocar nisso.
2. Escrever o ADR de abstração de cadeia **antes** de qualquer código — a fronteira `ChainAdapter` decide quanto do TS sobrevive, e ela é barata de mover no papel e cara de mover depois.
3. Rota A (Solidity) com o crate de policy preservado como oráculo diferencial, mirando **Arbitrum One** primeiro.
4. Reprojetar o modelo de outcome como trabalho próprio, com seus próprios cenários e testes, e não como item de tradução dentro da fase 1.
5. Reabrir a tese de go-to-market antes do deploy, não depois.

---

## 10. O que este parecer não cobre

- Não mediu gas real: as estimativas da §5.4 são analíticas, não medidas em fork.
- Não avaliou se a Robinhood Chain tem Stylus habilitado (relevante só para a Rota B).
- Não avaliou bridges nem operação simultânea Solana + EVM, que é um terceiro produto e não um port.
- Não considerou custo de oportunidade contra o backlog P1 atual, que é decisão de produto e não de arquitetura.
