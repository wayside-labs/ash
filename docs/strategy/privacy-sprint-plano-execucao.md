# Privacy Sprint — template Cloak + Zcash disparado pelo chat

**Status:** implementado na árvore de trabalho (nada commitado) e verificado **offline**: testes,
tipos, lint e o navegador com um SDK de mentira. **Nada foi executado na mainnet.** O que falta
é o que só você faz: assinar com a Phantom, o canário e a execução gravada (§14). O texto abaixo
é o plano como foi escrito às 10:45 BRT de 2026-10-04; a §14 diz o que mudou depois da revisão
adversarial.
**Prazo da trilha:** segunda 2026-10-05, 04:00 BRT — **17 h** a partir de agora.
Prazo do Hackathon principal (12/10) não muda e este plano não mexe nele.

Fonte das regras: <https://privacy.superteam.com.br/#desafio>. Contexto anterior desta
conversa: `cloak-privacy-sprint-sidetrack` na memória do projeto.

---

## 1. O que vamos entregar

Um template built-in, `builtin:cloak-private-payout` ("Private payout desk"), que o operador
**dispara pelo chat**:

```
você (chat) ── "pague 0,02 SOL ao fornecedor X e 0,02 SOL em ZEC à Y" ──▶ Haiku (OpenRouter)
                                                                            │ só propõe
                 bloco ```template-run (JSON validado) ◀────────────────────┘
                              │
              cartão de aprovação no chat  (endereços completos, taxas, selo MAINNET)
                              │ você clica "Executar na mainnet"
                              ▼
   navegador ── Cloak SDK (carregado só agora) ── Phantom assina ──▶ relay Cloak / Solana mainnet
        shield SOL ─▶ saque privado em SOL ─▶ swap privado SOL→ZEC ─▶ CSV da viewing key + pacote de prova
```

- **Um fluxo cobre as duas trilhas.** O pagamento em SOL é a trilha Cloak. O swap privado para
  o ZEC verificado na Solana (`A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS`) é a trilha Zcash,
  categoria "ZEC na Solana" — e é a ideia nº 02 da própria página do desafio.
- **O modelo só propõe.** Não assina, não vê chave nem nota, não executa. É o mesmo padrão do
  cartão de conector que já existe (`connector-card.tsx`), não um laço de tools.
- **Fora do cofre, fora do programa.** Nada muda em `programs/ash`, nada entra em
  `packages/mcp` e o agente continua com sete tools. É um fluxo de "mesa" (ADR-025).
- **Fundos próprios, valores pequenos.** ~0,16 SOL passam por duas carteiras descartáveis suas
  e quase tudo volta para carteiras suas. O custo real são as taxas de saída: ~US$ 2 por
  execução completa, ~US$ 5 nas três execuções do plano (smoke Node, canário, chat).

Escada de corte (se o tempo apertar, corta de baixo para cima):

| Nível | Inclui | Prova que sobra |
|---|---|---|
| **L1** | Núcleo do runner + execução Node + docs do template + texto + vídeo | 3 assinaturas na mainnet pelo script |
| **L2** (o pedido) | + template no catálogo + gatilho no chat + execução no navegador com Phantom + CSV + pacote de prova + verificador | as mesmas assinaturas, geradas **pelo chat** |
| **L3** (só se sobrar tempo) | + perna de ZEC nativo (NEAR Intents) + MCP `mcp cloak` keyless | um txid na rede Zcash |

---

## 2. Regras do desafio → onde cada uma é cumprida

| Regra da página | Como cumprimos | Quem |
|---|---|---|
| **Elegibilidade:** participa do Hackathon da Colosseum **e** é do the/Garage; uma submissão por time | Confirmar a participação no the/Garage. Se não for, a trilha não vale e paramos aqui | você |
| **Código:** repo no GitHub, público ou com acesso para os jurados; indicar branch/PR/intervalo feito no sprint | PR `feat/cloak-private-payout` → `main`; intervalo `55d707c..HEAD` (55d707c = `main` hoje). **Não consegui verificar a visibilidade do repo:** o `gh` desta máquina (conta `0xcf07`) não resolve `wayside-labs/ash`, o que sugere privado ou conta sem acesso. Torne público ou dê acesso aos jurados | você |
| **Prova:** assinatura na mainnet (Cloak); transação Zcash; ou app publicado | ≥3 assinaturas de mainnet no pacote de prova (shield, saque SOL, swap ZEC), com links e verificador. L3 acrescenta um txid Zcash | execução |
| **Vídeo ≤ 2 min** | Roteiro na §13; você grava | você |
| **Texto de privacidade ≤ 300 palavras** (o que fica escondido, de quem, o que se ganha) | Rascunho na §13: **293 palavras**, com o que **não** fica escondido | eu |
| "Nada de fundos de terceiros; teste com usuários só com consentimento" | Só carteiras suas; execução na mainnet atrás de flag desligada por padrão; cartão exige confirmação explícita | design |
| Regras da Colosseum: declarar trabalho pré-existente; só o sprint é julgado | Código novo, commits novos; o PR lista o que é reaproveitado (chat, templates, padrão do conector) e sua data | eu |
| Diretrizes de código da Cloak (CLAUDE.md deles) | Nunca logar segredo; `relayUrl` explícito; no navegador `signMessage` + `walletPublicKey`; valores em `bigint`; `DEFAULT_CIRCUITS_URL` — cada uma vira teste ou revisão (§8) | eu |

**Ambiguidade que não consigo resolver sozinho:** a prova da trilha Zcash diz "uma transação
Zcash (mainnet, testnet ou regtest)". Nosso fluxo prova ZEC **na Solana** (que a categoria
aceita por nome) com uma assinatura de mainnet da Cloak. Uma leitura estrita pode exigir um
txid na rede Zcash. Por isso existe o L3 como seguro (~US$ 4) e vale uma pergunta no the/Garage.

---

## 3. Base técnica verificada hoje

Tudo abaixo eu executei ou li no código; o que ficou sem verificar está no apêndice A.

| Fato | Resultado | Como verifiquei |
|---|---|---|
| `@cloak.dev/sdk@0.2.5` é nativo em Kit e carrega só quando chamado | Build de produção do **Next 15.5.4** (mesma versão do dashboard) compila com o SDK em `import()` dinâmico, 103 kB de JS inicial | app de teste no scratchpad |
| Roda no navegador | Chromium headless: SDK carrega (325 exports), gera chave e nota, **baixa e confere por hash 22,9 MB de circuitos em 3,3 s**, sem erro de console. `calculateFeeBigint(0,02 SOL) = 5.060.000` lamports (0,005 + 0,3%) | Playwright 1.63 |
| Circuitos e relay aceitam o navegador | `storage.googleapis.com/cloak-circuits/...` e `api.cloak.ag`: `access-control-allow-origin: *` | `curl` |
| **RPC público de mainnet bloqueia navegador** | `POST` com `Origin` de navegador → **403** (inclusive `console.ash.app.br`); sem `Origin` → 200; o de devnet aceita | `curl`, com controle |
| **RPC de mainnet sem cadastro que aceita navegador** | PublicNode (`https://solana-rpc.publicnode.com`): preflight 204 e `ACAO: *`; 30 chamadas seguidas sem 429; `getSignaturesForAddress` e `getTransaction` respondem. Ankr (403), dRPC (400) e o público da Solana (403) não servem | `curl` |
| Rota para SOL→ZEC existe | Jupiter: 0,02 SOL → 0,00183 ZEC, impacto 0, rotas Kipseli/GoonFi V2; CORS `*` | `curl` |
| Swap privado da Cloak | Entrada só SOL; saída "qualquer token verificado da Jupiter", ZEC é padrão; mínimo 0,01 SOL; saída custa 0,005 SOL + 0,3%; depósito é grátis | doc da Cloak + código do SDK (`swapWithChange`) |
| Assinatura no navegador **sem `web3.js`** | `signerFromWalletAdapter` só precisa de `VersionedTransaction.deserialize(bytes)` e de um resultado com `.serialize()`: um shim de ~40 linhas sobre o `signWithStandardWallet` que já existe (`lib/wallet-standard.ts:36`) | código do SDK |
| Aprovações na carteira | Envio/saque: 1 `signMessage`. Swap: 1 a 5. Depósito: cria ALT efêmera (2 txs) + a tx do depósito. Total esperado **6–9 prompts** | `index.d.ts`, `index.js` |
| Notas **recuperáveis pela cadeia** | `createRecoverableDepositUtxo`, `recoveredDepositNotes` e `recoveredChangeNotes` no `scanTransactions`, `deriveUtxoKeypairFromSpendKey` ("todas as notas usam o mesmo `nk`") | `index.d.ts` |
| A `nk` não é só de leitura, e o SDK a envia ao relay | As notas de depósito recuperáveis têm chave de gasto e blinding derivados de `(nk, salt)`; o troco reaproveita a chave da nota de entrada (e por isso o `scanTransactions` o devolve com `privateKey = 0n`). Quem tem a `nk` reconstrói as notas, e só o relay (que exige assinatura da carteira) fica no caminho do gasto | código do SDK |
| Relay cria o ATA do destinatário no swap | O tipo `UtxoSwapParams.recipientWallet` diz "used by relay to create ATA if missing"; falta ver na mainnet | `index.d.ts` |
| NEAR Intents (ZEC nativo) | Cotação **dry** funciona sem chave (HTTP 201, 1200 req/min). Mínimo **14.610.005 lamports**. 0,03 SOL → 0,00242 ZEC (US$ 3,22 de 3,66). **Só entrega em endereço transparente (t1/t3)**, não shielded | `curl` + doc |
| Chat | Texto puro em streaming, **sem `tools` por construção** (`openrouter-api.ts:8-9`, teste `openrouter-api.test.ts:86-101`); só o bloco `connector-bundle` vira cartão; histórico não é persistido; um stream por processo | código + agente |
| Templates | Receita descritiva (workflow + agentes + linhas de MCP); **não existe motor de execução** nem ligação com o chat | código + agente |
| ADR-017 | "Até o passkey existir, nenhum segredo é persistido"; não há IndexedDB nem cofre cifrado | código + agente |
| Próximo número de ADR | **027** (a 026 é "hosted chat runs on the platform key") | `docs/adr/` |

---

## 4. Decisões de arquitetura

**D1 — O gatilho é um bloco cercado, não tool calling.** O chat é tool-less por desenho e por
teste; um laço de tools exigiria streaming estruturado, somar o uso de cada passo no billing e
reescrever as guardas que hoje afirmam "sem tools". O cartão de conector já provou o padrão: o
modelo propõe, o cliente valida com Zod, o humano decide. *Descartado:* tool calling (custo alto, quebra o invariante "chat read-only").

**D2 — Execução no navegador, com a carteira do operador.** O chat é guiado por LLM e lê texto
não confiável; uma chave guardada no servidor seria a opção B que a ADR-025 rejeitou e
contraria a ADR-017. No navegador, cada prompt do Phantom é um portão humano. *Descartado:*
chave de mesa no servidor.

**D3 — Chaves derivadas da carteira; nada secreto é persistido.** O SDK manda guardar as notas
de troco (perdida a nota, a doc diz que o valor fica irrecuperável, a menos que ela seja
recuperável pela cadeia), e o dashboard não tem cofre. Em vez de inventar um: as chaves vêm de uma assinatura da carteira (`signMessage` de uma mensagem fixa → HKDF →
`deriveSpendKey` → `deriveUtxoKeypairFromSpendKey`), toda nota é criada em forma
**recuperável**, e uma nota perdida se reconstrói por `scanTransactions` com o mesmo `nk`.
Retomada = reescanear a cadeia. *Risco:* depende de `signMessage` determinístico. Ed25519 é,
mas confirmamos assinando duas vezes na primeira execução, guardamos só um checksum (público)
e oferecemos um arquivo de recuperação opcional. A `nk` reconstrói as chaves de gasto das notas de depósito recuperáveis (`deriveDepositNoteSecrets(nk, salt)` no SDK): é segredo de gasto, não só de leitura. **Ela sai do navegador num único lugar: o SDK a registra no relay da Cloak (`/viewing-key/register`)**, que por isso poderia reconstruir essas notas; gastar ainda exige a assinatura da carteira nos pedidos ao relay, e os tetos (0,01–0,05 SOL por pagamento, ≤ 0,10 SOL por execução) limitam o que essa confiança custa. O contador recebe o CSV, nunca a chave. *Descartado:* cofre IndexedDB cifrado (mais
código, mesma dependência da assinatura, e conflita com a ADR-017).

**D4 — Fluxo de mesa fora do cofre (ADR-025).** Não passa por `execute_payment` nem por
`IntentReceipt`. A política (teto por execução e por pagamento, 1–4 pagamentos, mint de ZEC
fixo) é **suave** e a interface diz isso. A ADR-027 registra a exceção.

**D5 — Um template, duas trilhas.** Cada pagamento tem `deliver: "SOL" | "ZEC"`. O mesmo
endereço pode receber os dois.

**D6 — Mainnet fixada no template, atrás de `NEXT_PUBLIC_CLOAK_MAINNET=1`.** É uma exceção
estreita a "Mainnet is refused in the UI" (`packages/dashboard/CLAUDE.md:45-46`): só este
template, independente do cluster do painel (hoje devnet), desligada por padrão. Além da flag,
só executa a carteira listada em `NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS` (lista do operador, falha
fechado): na VPS isso impede que a flag vire porta de entrada para fundos de terceiros.

**D7 — Nenhuma rota de API nova.** Não toca `route-guard.test.ts` nem o limitador global
(60/min). O navegador chama RPC, relay e Jupiter direto (todos com CORS aberto, exceto o RPC
público — daí o pré-requisito do RPC dedicado).

**D8 — Pacote novo `@ash/cloak` com portas injetadas** (SDK, carteira, relógio,
emissão de eventos), dependências pesadas isoladas, `dist` + `transpilePackages`. Os schemas
ficam em `@ash/contract/template-run` (**subpath**: a raiz importa `node:crypto` e só
o `next build` pega).

**D9 — MCP `mcp cloak` keyless só no L3.** Planejar/cotar/verificar, sem chave (padrão ADR-025).

---

## 5. Como uma execução funciona

Exemplo da demo: 0,02 SOL em SOL e 0,02 SOL em ZEC, os dois para uma carteira nova sua.

| # | Passo | O que acontece | Prompt da carteira |
|---|---|---|---|
| 0 | Pré-checagem (leitura) | carteira conectada, saldo ≥ total + 0,02 SOL, relay e circuitos alcançáveis, endereços válidos e ≠ pagador, cotação Jupiter para ZEC, tetos | — |
| 1 | Derivar chaves | `signMessage` da mensagem fixa; na 1ª vez, duas vezes | 1–2 |
| 2 | Registro da viewing key | o SDK registra o `nk` no relay | 1 |
| 3 | Shield | `transact` de depósito de 0,04 SOL, nota recuperável | 2–3 (ALT + depósito) |
| 4 | Pagamento SOL | `partialWithdraw`; taxa 0,005 + 0,3% = 0,00506; líquido ≈ 0,01494 SOL | 1 |
| 5 | Pagamento ZEC | `swapWithChange` SOL→ZEC com `minOutput` = cotação −2%; ≈ 0,00137 ZEC | 1–5 |
| 6 | Relatório | `scanTransactions` → `toComplianceReport` → CSV; pacote de prova (só dados públicos) | — |

- **Custo real por execução** ≈ taxas de saída (2 × 0,00506 SOL) + rede/ALT (a medir no
  smoke) ≈ 0,015 SOL ≈ US$ 2. O resto do valor chega às carteiras de destino.
- **Retomada:** o navegador guarda só o que é público (as assinaturas já obtidas, e se um depósito
  pode ter entrado sem assinatura para citar). Ao retomar, deriva as chaves, reescaneia **só as
  notas descendentes do depósito dessa execução** e compara o que sobrou com o que ainda é
  devido: sobrar menos que o devido significa que um saque saiu sem ser registrado, e a
  execução para em vez de repeti-lo. **Recuperar** é a outra saída: varre tudo que as chaves
  reconstroem (inclusive o reembolso de um swap que expirou) de volta para a carteira.
- **Fluxo de erro:** `describeWalletError` (`use-dashboard.ts:595`) traduz as rejeições da
  carteira, que chegam como objetos simples.

---

## 6. O gatilho no chat

**Contrato** (`packages/contract/src/template-run.ts`, subpath `./template-run`):

```json
{
  "apiVersion": "ash.template-run/v1",
  "template": "builtin:cloak-private-payout",
  "payees": [
    { "label": "Fornecedor A", "address": "<endereço Solana>", "deliver": "SOL", "amountSol": "0.02" },
    { "label": "Fornecedor A", "address": "<endereço Solana>", "deliver": "ZEC", "amountSol": "0.02" }
  ]
}
```

- `strictObject`: campo desconhecido é rejeitado. **O modelo não escolhe a rede**; ela é
  fixada pelo template.
- Validações: 1–4 pagamentos; endereço base58 de 32 bytes; sem duplicata de
  (endereço, `deliver`); `amountSol` decimal ≥ 0,01 e ≤ 0,05 por pagamento, total ≤ 0,10;
  `label` ≤ 40 caracteres. Os tetos são constantes do template (não argumento do modelo).
- `extractTemplateRunProposals(text)` espelha `extractConnectorProposals`: só blocos fechados;
  bloco inválido vira cartão de aviso com a mensagem do Zod, nunca é aplicado pela metade.

**Prompt** (`system-prompts.ts`, EN + pt-BR): nova seção "Template runs", em **prosa**, sem
exemplo literal fechado — o `system-prompts.test.ts:19-24` proíbe isso porque modelos copiam.
Regras: nunca inventar endereço (perguntar), valores em SOL, ZEC = swap privado para o mint
verificado (e público depois de entregue), dizer que nada roda até o operador aprovar na
carteira, nunca afirmar que rodou, nunca pôr chave/nota/segredo.

**Cartão** (`template-run-card.tsx`): selo vermelho **MAINNET — fundos reais**; por pagamento:
rótulo, endereço completo, entrega, bruto, taxa, líquido; total e saldo necessário; duas
confirmações obrigatórias ("conferi os endereços completos", "é mainnet e irreversível");
botões Executar / Cancelar. Durante: linha do tempo com links do explorer. No fim: baixar CSV,
baixar pacote de prova, copiar resumo.

**Confiabilidade com o Haiku:** schema mínimo; validação com mensagem clara; um **ensaio
automático** (`scripts/rehearse-template-prompt.ts`, ~US$ 0,02) chama o chat real 10 vezes e
exige ≥ 9 blocos válidos antes de gravar o vídeo. Se falhar, ajusta o prompt, não o schema.

---

## 7. Mapa de arquivos

**Novos**

| Caminho | Para quê |
|---|---|
| `packages/contract/src/template-run.ts` (+ export e entrada do tsdown) | schemas, fence, `extractTemplateRunProposals`, eventos, pacote de prova |
| `packages/cloak/` (`@ash/cloak`, privado) | plano e taxas, política, derivação de chaves, runner com retomada, relatório/CSV, adaptador do SDK (import dinâmico), adaptador Node, `smoke`, `verify` |
| `packages/dashboard/src/components/chat/template-run-card.tsx` | cartão de aprovação |
| `packages/dashboard/src/hooks/use-template-run.ts` | liga cartão, carteira e runner |
| `packages/dashboard/src/lib/templates/runners/cloak-private-payout.ts` | registro: id → schema → plano → execução (consulta com `Object.hasOwn`) |
| `examples/templates/cloak-private-payout/` | README, `policy.example.json`, `PRIVACY.md`, `VIDEO.md`, `PROOF.md`, `scripts/`, `agents/payout-planner.md` |
| `docs/adr/ADR-027-…md`, `docs/product/cloak-private-payout.md` | decisão e produto |
| `.claude/skills/cloak-sdk/SKILL.md` | guardrails da Cloak + nossas invariantes, para o próximo agente |

**Alterados**

| Caminho | Mudança |
|---|---|
| `dashboard/src/lib/templates/catalog.ts` | `BuiltinTemplateId` + entrada `builtin:cloak-private-payout` |
| `dashboard/src/lib/templates/localize.ts` | `BUILTIN_I18N_KEY` |
| `dashboard/src/i18n/locales/en.json`, `pt-BR.json` | `templates.builtin.cloak-private-payout.*` e textos do cartão |
| `dashboard/src/components/chat/chat-panel.tsx` | `AssistantContent` trata as duas cercas |
| `dashboard/src/lib/server/llm/system-prompts.ts` (+ teste) | seção "Template runs" |
| `dashboard/src/lib/wallet-standard.ts` | `signMessage` por Wallet Standard (hoje só existe pelo provedor injetado) |
| `dashboard/next.config.ts`, `package.json` | `transpilePackages`, dependência |
| `.env.example` do dashboard, `deploy/vps/dashboard.public.env.example` | `NEXT_PUBLIC_CLOAK_MAINNET`, `NEXT_PUBLIC_CLOAK_RPC_URL`, `NEXT_PUBLIC_CLOAK_ALLOWED_WALLETS` (públicas: entram no bundle no build) |
| `dashboard/e2e/templates.spec.ts:87` | `toHaveCount(4)` → 5 |
| `dashboard/e2e/fixtures.ts` | stub com `solana:signMessage`; stub de chat com o bloco |
| `dashboard/playwright.config.ts` | zerar `OPENROUTER_API_KEY` (hoje não zera: um teste pode gastar a chave real) |
| `examples/templates/README.md` | nova linha; a frase "nenhum adiciona pacote" e "devnet primeiro" deixam de valer |
| `docs/strategy/colosseum-plano-execucao.md:59` | "Não existe side track da Cloak" está desatualizado |
| `packages/integrations/` (**L3**) | `mcp-cloak.ts`, `cloak/{config,policy,tools}.ts`, `cli.ts`, `workstation-integrations.ts` |

---

## 8. Invariantes que não podem quebrar

| Invariante | Como é garantido |
|---|---|
| Agente com sete tools; nenhuma ferramenta que escale | `packages/mcp` e `contract/mcp-tools.ts` intocados (`tool-surface.test.ts`) |
| O chat não envia `tools` | `openrouter-api.test.ts:86-101` continua passando |
| A `nk` só sai do navegador para o relay da Cloak (o SDK a registra); o contador recebe só o CSV | o CSV é gerado no navegador e é o que se compartilha; o teste de vazamento cobre eventos, prova, CSV, log e console; **o envio ao relay é dito** no cartão, na doc, na ADR-027 e no texto de privacidade | 
| Nenhum segredo é persistido, e nosso código não envia nenhum a lugar nenhum | eventos tipados só com dados públicos + teste que roda a execução com SDK falso e falha se qualquer byte derivado (hex/base64/base58) aparecer no log, nos eventos ou no pacote; nenhuma rota nova; nada no `localStorage` além de estado público |
| Dashboard não nomeia `get…Instruction` | `privileged-surface.test.ts:125-137`; construtores ficam no pacote |
| Toda rota mutante chama `assertSameOrigin` | não criamos rota |
| Cliente importa subpaths do contract | `next build` no canário da F1 |
| Mainnet só com flag | teste do cartão: sem flag, o botão fica desabilitado e explica |
| Política suave dita como suave | texto do cartão e da ADR-027 |
| Nota recuperável por `nk` | teste de aceitação no smoke: depois do shield, `scanTransactions` com o `nk` derivado devolve a nota em `recoveredDepositNotes` |
| Diretrizes da Cloak | revisão na PR: sem log de segredo, `relayUrl` explícito, `bigint`, `DEFAULT_CIRCUITS_URL` |
| `reactStrictMode` roda efeitos duas vezes | execução só dispara por clique, com trava por `runId` |

---

## 9. Testes

- **Contract:** schema e fence, incluindo adversariais (cerca dentro de cerca, JSON gigante,
  base58 inválido, duplicata, pagador = pagamento, valores fora do teto).
- **`@ash/cloak`:** taxas com paridade contra `calculateFeeBigint`; política; runner com
  SDK falso e **falha injetada depois de cada passo** (retomada sem reenviar saque); derivação
  determinística; relatório sem segredo.
- **Dashboard (vitest):** cartão, prompt (sem exemplo parseável; seção presente nas duas
  línguas), registro de runners, `privileged-surface` e `route-guard`.
- **Playwright (`scripts/verify.sh ui`, ~4 min):** chat stubado devolve o bloco → cartão →
  Executar → SDK falso → linha do tempo → downloads. O fluxo de mainnet real **não** entra em CI.
- **Manual na mainnet** (você roda): `smoke` Node (dry-run por padrão; só envia com
  `--confirm-mainnet`), canário no navegador, execução pelo chat.
- **Portões:** `pnpm lint`, `pnpm build`, `pnpm test`, `scripts/verify.sh ts` (o `pnpm audit`
  já está vermelho por causa do SODAX e por ambiente; medimos o que o SDK da Cloak soma).

---

## 10. Cronograma e portões

Com T0 = quando você disser "vai". Exemplo com T0 = 12:00; folga final de ~3,5 h.

| Fase | Janela | Quem | Pronto quando |
|---|---|---|---|
| F0 Pré-requisitos | antes de T0 | você | itens da §11 resolvidos |
| F1 Esqueleto | 12:00–12:45 | eu | branch; `template-run` no contract com testes; `packages/cloak` compila; **canário:** `next build` do dashboard importando o pacote; `pnpm audit --prod` medido |
| F2 Núcleo do runner | 12:45–15:00 | eu | plano/taxas/política/derivação/runner com SDK falso verdes; adaptador Node e `smoke` com dry-run |
| **F3 Smoke na mainnet — Portão A** | 15:00–16:00 | você, comigo | **Node:** 3 assinaturas (shield, saque SOL, swap ZEC), taxa real, se o swap cria o ATA, nota recuperada pelo `nk`. **Navegador:** canário shield 0,01 SOL + saque com Phantom e RPC dedicado |
| F4 Template + chat | 16:00–20:00 | eu | entrada no catálogo; cerca, cartão, prompt, i18n; assinatura Wallet Standard; e2e com SDK falso; ensaio do Haiku ≥ 9/10 |
| F5a Deploy na VPS (**só se você escolher rodar lá**) | 20:00–20:45 | eu, com seu OK | sha ao vivo conferido; as três variáveis no `dashboard.public.env`; `push-deploy.sh`; página abre; flag e lista de carteiras ativas. Soma 45 min a tudo abaixo |
| **F5 Execução pelo chat — Portão B** | 20:00–21:30 | você, comigo | uma execução completa disparada pelo chat na mainnet: assinaturas, CSV, pacote de prova |
| F6 Docs e PR | 21:30–23:00 | eu | README, ADR-027, doc de produto, skill, `verify`, PR com intervalo de commits |
| F7 Vídeo e formulário | 23:00–00:30 | você, comigo | vídeo ≤ 2 min; formulário enviado; link de edição salvo |
| Folga | 00:30–04:00 | — | só correção; nada novo |

**Regras dos portões**
- **A passa** (Node e navegador): segue para F4.
- **Node passa, navegador falha:** 30 min para corrigir a ponte da carteira. Se não sair, declaramos a
  execução pelo runner Node e o chat como camada de proposta (L1 honesto), sem prometer execução pelo chat.
- **Node falha** (relay, triagem de risco): 60 min de depuração; depois disso a trilha não tem
  como cumprir "prova" e paramos.
- **Atraso:** cada hora que T0 escorrega come uma hora de folga. Se a F5 não começar até 22:00,
  cai para L1.
- **L3 só** se o Portão B fechar até 21:00.

**Eu não assino nem envio nada na mainnet.** Todo passo com fundos é executado por você, e o
`smoke` exibe o resumo e exige confirmação explícita antes de enviar.

---

## 11. O que preciso de você

| # | Item | Quando |
|---|---|---|
| 1 | Confirmar que você está no the/Garage | agora |
| 2 | **RPC de mainnet que aceite chamada de navegador.** Para o canário, sem cadastro: `https://solana-rpc.publicnode.com` (testei). Para a execução gravada, uma chave própria (Helius/Alchemy/QuickNode) é mais segura contra limite de taxa. **A liberação é no painel do provedor** ("allowed origins"), não na VPS nem na sua máquina, e deve listar o origin de onde o painel roda: `https://console.ash.app.br` se for a VPS, `http://127.0.0.1:3000` se for local (pode listar os dois). Se o provedor não tem essa opção, está aberto e não há nada a fazer. Não cole a URL com a chave no chat: ponha no `.env.local` e eu testo sem imprimir | antes da F3 (canário: já resolvido) |
| 3 | Uma conta Phantom **descartável** só para isso, com ~0,10 SOL, e uma keypair CLI descartável com ~0,06 SOL para o `smoke` Node. **Não** use a chave de autoridade do programa, a do CI nem a do operador | antes da F3 |
| 4 | Um ou dois endereços de destino **novos** (seus) | antes da F3 |
| 5 | Visibilidade do repo (público ou jurados com acesso) e **OK para eu fazer push da branch e abrir o PR** (push é ação externa; não faço sem você pedir) | antes da F6 |
| 6 | **Onde roda e onde grava: local ou VPS.** Local (`pnpm dashboard`) é o padrão do plano e não exige deploy. VPS exige a F5a: o deploy constrói a partir de uma ref do git (`push-deploy.sh <branch>`), as `NEXT_PUBLIC_*` são embutidas no build a partir de `/etc/agent-rails/dashboard.public.env`, e preciso conferir o sha ao vivo antes (a memória diz que produção já rodou de uma branch própria). Deploy em produção é ação externa: só com o seu OK | antes da F4 |
| 7 | Marcar a rede Zcash na inscrição do Colosseum? Isso muda o posicionamento da trilha principal (o plano atual diz "Fora"). Decisão sua, fora deste plano | até 12/10 |

**Decisões que tomei por conta própria** (diga se quiser outra): mainnet atrás de flag
desligada; um template com duas entregas (SOL e ZEC); chaves derivadas em vez de cofre;
execução no navegador em vez de servidor; sem MCP e sem perna de ZEC nativo antes do L3; texto
de privacidade em português.

---

## 12. Riscos

| Risco | Efeito | Mitigação |
|---|---|---|
| Phantom/ALT/relay se comportam diferente no navegador | Portão B atrasa | canário no navegador no Portão A; runner Node como prova de reserva |
| `signMessage` não determinístico | chaves diferentes entre sessões → fundos presos | assinar duas vezes na 1ª execução; checksum público; arquivo de recuperação; recusar depósito se o checksum divergir |
| RPC público 403 / limite de taxa | execução quebra no meio | PublicNode no canário; chave própria com origins liberados na execução gravada; retomada por reescaneamento |
| Triagem de risco do relay recusa o endereço | execução bloqueada | endereços novos; falha clara; contato com a Cloak |
| Swap não cria o ATA do destinatário (o SDK diz que o relay cria quando recebe `recipientWallet`) | passo ZEC falha | o `smoke` responde; plano B: o destinatário cria o próprio ATA com SOL recebido no passo anterior |
| Haiku emite bloco inválido | demo sem gatilho | validação com mensagem; ensaio ≥ 9/10; ajustar o prompt |
| Injeção de prompt troca um endereço | pagamento ao destino errado | cartão mostra endereço completo, exige conferência e o modelo não executa |
| Anonimato pequeno (pool com pouco movimento) | valor/horário correlacionáveis | dito no texto; valores distintos e intervalo entre passos |
| Exceção de mainnet num produto de postura devnet | percepção | flag desligada, ADR-027, escopo só deste template |
| `pnpm audit` piora | CI já vermelho | medir o delta na F1 e registrar; não bloqueia |
| E2E gasta a chave real do OpenRouter | custo | zerar `OPENROUTER_API_KEY` no `playwright.config.ts` |
| Tempo | trilha não fecha | escada L1/L2/L3 e regras dos portões |

---

## 13. Material de submissão

### Texto de privacidade (294 palavras)

**O que fica escondido.** Hoje, quando um agente de IA paga fornecedores ou contribuidores com dinheiro da empresa, cada pagamento fica público na Solana: quem recebeu, quanto e quando. Com o template *Private payout desk* do ASH, o operador pede no chat "pague 0,02 SOL ao fornecedor A e 0,02 SOL em ZEC ao contribuidor B". O dinheiro entra no pool da Cloak e sai para endereços novos. Quem olha a cadeia vê um depósito e saques de um pool compartilhado, mas não qual virou qual. O swap privado entrega ZEC (mint verificado) a um endereço sem vínculo direto com a carteira que financiou.

**De quem.** De observadores da cadeia: concorrentes e analistas on-chain que hoje mapeiam fornecedores e folha de pagamento a partir de um único endereço. Não esconde valores nem horários nas bordas; com pouco movimento no pool, depósito e saques podem ser casados por valor e horário. Não esconde nada da Cloak: o relay autentica a carteira e recebe a viewing key, que para estas notas reconstrói as chaves delas; por isso os tetos. O ZEC entregue é um token comum até ser blindado numa carteira Zcash. Não prometemos invisibilidade contra um adversário determinado.

**O que se ganha.** (1) Sigilo comercial: fornecedores e valores deixam de ser públicos. (2) Auditoria preservada: a viewing key, derivada da carteira, gera no navegador um CSV que o contador concilia com o `audit export`; ele recebe o CSV, nunca a chave. (3) Controle: o chat só propõe; nada se move sem a aprovação do operador na própria carteira, com teto por execução e endereços completos na tela. O modelo nunca vê chaves nem notas; as chaves vêm da carteira e não ficam guardadas. O agente trabalha em silêncio e o dono continua enxergando tudo.

*(Reconte as palavras depois de qualquer edição; o limite é 300.)*

### Roteiro do vídeo (≤ 2:00)

| Tempo | Cena |
|---|---|
| 0:00–0:12 | "Sua carteira é um diário público": explorer de uma tesouraria de agente com todos os fornecedores à vista |
| 0:12–0:30 | `/templates` → "Private payout desk" → canvas (o que o template monta) |
| 0:30–1:10 | Chat: o pedido em linguagem natural → resposta + cartão (endereços completos, taxas, selo MAINNET) → Executar → prompts do Phantom (cortados na edição) → linha do tempo com assinaturas |
| 1:10–1:40 | Explorer: depósito (financiador → Cloak) e saques (Cloak → destinos); nenhuma transação ligando financiador e destinos; a carteira destino com SOL e ZEC |
| 1:40–2:00 | CSV da viewing key aberto + as três frases do texto de privacidade + link do repo |

### Formulário (campos que conheço pela página; o formulário em si eu não vi)

Repo + branch/PR + intervalo `55d707c..HEAD` · assinaturas da mainnet · vídeo · texto de
privacidade · categorias **Cloak + Zcash** ("os dois") e o caso de uso "pagamentos privados"
· contato para o payment link do prêmio.

### Checklist final de regras (marcar com evidência antes de enviar)

- [ ] the/Garage confirmado
- [ ] repo acessível aos jurados; PR aberto; intervalo de commits no formulário
- [ ] ≥ 3 assinaturas da mainnet, verificadas pelo `verify`
- [ ] vídeo ≤ 2:00 mostra execução **real** (não a de SDK falso)
- [ ] texto ≤ 300 palavras (reconferido)
- [ ] só fundos próprios
- [ ] marcado "os dois" no formulário
- [ ] link de edição salvo (vale até 05/10, 04:00)

---

## Apêndice A — O que não verifiquei

- **Prova no navegador** (snarkjs com workers) e **chamadas ao relay** a partir do navegador: o
  teste de hoje cobriu carga do SDK, chaves, notas e circuitos, não uma execução real.
- Se o relay aceita endereços novos sem recusar na triagem de risco (Range).
- Se o relay mesmo cria o ATA do destinatário no swap (o tipo do SDK diz que sim; falta ver na mainnet), e o comportamento com valores tão pequenos. **Os dois destinos do usuário estão sem conta (saldo zero): o ATA de ZEC do contribuidor será criado pelo relay, ou o passo falha.**
- Se o Phantom altera a transação (Lighthouse) de um jeito que atrapalhe a verificação de
  cotação de risco no índice 0.
- Como os jurados leem a exigência de prova da trilha Zcash (§2).
- Os campos reais do formulário, e se o chat roda mesmo em modo local (é inferência do agente
  que leu o `.env.local`; não li o valor da chave).
- Algumas páginas da doc da Cloak chegaram resumidas por um modelo pequeno; as assinaturas
  que importam eu conferi no código e nos tipos do pacote instalado.

## Apêndice B — Defeitos pré-existentes achados pelo caminho (fora de escopo)

Do mapeamento dos templates; nenhum bloqueia o plano, e só o primeiro eu corrijo de passagem:

1. `isBuiltinTemplateId` usa `in` (`catalog.ts:167`): `"constructor"` como id vira um `TypeError`.
   Uso `Object.hasOwn` no nosso registro.
2. `POST /api/templates/apply` chama `readState()` fora do `try/catch` (`route.ts:43`): um acesso
   negado em modo hospedado vira 500.
3. Um `workflowName` só com espaços passa na rota e o `trim` o deixa vazio; no modo JSON o
   arquivo é quarentenado na leitura seguinte.
4. Apagar um workflow não apaga as linhas de MCP que o template criou; os escopos são por nome
   e colidem se dois workflows têm um agente chamado "Executor".
