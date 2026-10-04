# Video script — Privacy Sprint (limit: 2:00)

The script from §13 of [`docs/strategy/privacy-sprint-plano-execucao.md`](../../../docs/strategy/privacy-sprint-plano-execucao.md),
unchanged and in Portuguese, with one English caption per row. The text read or shown in the last
scene is [`PRIVACY.md`](PRIVACY.md) (English: [`PRIVACY.en.md`](PRIVACY.en.md)).

| Tempo | Cena | Caption (EN) |
|---|---|---|
| 0:00–0:12 | "Sua carteira é um diário público": explorer de uma tesouraria de agente com todos os fornecedores à vista | "Your wallet is a public diary": an agent treasury on the explorer, every supplier in plain sight. |
| 0:12–0:30 | `/templates` → "Private payout desk" → canvas (o que o template monta) | The templates page, "Private payout desk", and what the template sets up on the canvas. |
| 0:30–1:10 | Chat: o pedido em linguagem natural → resposta + cartão (endereços completos, taxas, selo MAINNET) → Executar → prompts do Phantom (cortados na edição) → linha do tempo com assinaturas | A plain-language request in the chat, the payout card (full addresses, fees, MAINNET seal), Run, and a timeline filling with signatures; the wallet prompts are cut in the edit. |
| 1:10–1:40 | Explorer: depósito (financiador → Cloak) e saques (Cloak → destinos); nenhuma transação ligando financiador e destinos; a carteira destino com SOL e ZEC | On the explorer: a deposit into Cloak, withdrawals out of it to the payees, no transaction linking funder and payees, and SOL and ZEC in the destination wallet. |
| 1:40–2:00 | CSV da viewing key aberto + as três frases do texto de privacidade + link do repo | The viewing-key CSV open, three sentences from the privacy text, and the repository link. |

The five windows add up to exactly 2:00 (12 + 18 + 40 + 30 + 20 seconds), so a scene that grows
has to take its time from another one.

## What the recording has to show

These come from the plan's final checklist (§13), not from a new rule:

- **A real execution.** The video shows the run on mainnet, not the fake-SDK run the Playwright
  suite uses. The signatures in the timeline of the 0:30–1:10 scene must be the ones in the proof
  pack ([`PROOF.md`](PROOF.md)) and the ones the explorer shows in the next scene.
- **Own funds only.** The wallet that signs is the operator's disposable one, never someone else's.
- **No secret on screen.** No seed phrase, no keypair file, and not the signature the keys are
  derived from. The proof pack and the CSV are made to be shown; nothing else is.
- **The 1:10–1:40 scene is the thesis.** What it shows is an absence: the funder's history with no
  payee in it and each payee's history with no funder in it. How to check that step by step is in
  [`PROOF.md`](PROOF.md#what-no-direct-link-means).

## Before recording

1. One complete run, done and verified, with its results filled in under
   [Run results](PROOF.md#run-results).
2. The privacy text recounted (the limit is 300 words; see `PRIVACY.md`).
3. The chat answering with a valid `template-run` block reliably. The plan's bar is at least 9
   valid blocks out of 10; `scripts/rehearse-template-prompt.ts` measures it against a running
   dashboard (usage is in its header, and it spends a few cents of the platform key).
