# Colosseum — relatório de implementação (prompts `texto.txt`)

**Gerado:** 2026-09-26  
**Baseline git:** `main` @ `8e319f5` (após merges #65–#73)  
**Fonte dos prompts:** `~/texto.txt` (formato “Anatomy of a Claude prompt”, P0-00 → HIG-01)

Este documento consolida **o que cada prompt pediu**, **o que foi entregue**, **onde está no repo**, e **o que ainda não é código** (submissão Colosseum).

---

## 1. Resumo executivo

| Camada | Situação |
|--------|----------|
| **Prompts de engenharia (P0 / P1 / HIG-01)** | **Concluídos em `main`**, exceto itens operacionais abaixo. |
| **Definition of done 10/10 (plano)** | **Parcial** — produto técnico forte; faltam vídeo, Earn, smoke manual assinado, formulário Colosseum. |
| **Mapa em `~/texto.txt` (final do arquivo)** | **Desatualizado** até você copiar a seção “Quick map” atualizada (ver §6). |

**PRs mergeados relevantes (ordem aproximada):** #65 chat+demo, #66 metrics B, #67 reference agent, #68 create_session, #69 docs sweep, #70 guardian, #71 Vercel adapter, #72 alerts, #73 HIG-01.

---

## 2. Prompt a prompt

### P0-00 — Chat: Claude CLI, não demo

| Stop condition | Status |
|----------------|--------|
| Sonnet padrão com CLI instalado | **Feito** — `fix(dashboard): auto-promote persisted demo model` |
| Demo só sem provider real | **Feito** — `model-selection.ts` + testes |
| Vitest verde | **Feito** |

**PR:** #65 (`15cc11f`). **Arquivos:** `packages/dashboard/src/components/chat/model-selection.ts`, `model-selection.test.ts`, `chat-panel.tsx`.

---

### P0-01 — F1: USDC ponta a ponta

| Stop condition | Status |
|----------------|--------|
| SPL/ATA dashboard + CLI | **Feito** — `buildVaultTransfer`, `vault-transfer` route, treasury UI |
| Docs alinhados | **Feito** no sweep #69; tabela plano marca **feito** |
| Testes mint ≠ SOL | **Feito** — e2e SPL (#60), métricas/histórico com USDC devnet |

**PRs:** #29 (dashboard F1), #60 (e2e USDC), #69 (docs). **Plano:** `colosseum-plano-execucao.md` F1 **feito**.

---

### P0-02 — F2b: Metrics Phase B

| Stop condition | Status |
|----------------|--------|
| Tabela + export CSV/JSON | **Feito** — `/metrics`, rotas/histórico RPC |
| i18n estados vazios/incompletos | **Feito** |
| `metrics-page.md` Phase B | **Feito** |

**PR:** #66. **Plano:** F2b **feito** (#69).

---

### P0-03 — F4: `scripts/demo.sh`

| Stop condition | Status |
|----------------|--------|
| Três provas Colosseum + explorer links | **Feito** — `scripts/demo.sh` |
| CLI `--confirm-timeout` (substitui retry helper) | **Feito** na mesma frente F4 |
| Run devnet documentado | **Feito** — README, CONTRIBUTING |

**PR:** #65 (`448c515`). **Plano:** F4 **feito**.

---

### P0-04 — ADR-021 Wave 1: `create_session` no dashboard

| Stop condition | Status |
|----------------|--------|
| `POST /api/solana/create-session` | **Feito** |
| `privileged-surface.test.ts` | **Feito** |
| Modal chave + snippet MCP | **Feito** |
| ADR-021 commitado | **Feito** — `docs/adr/ADR-021-operator-surfaces-cli-and-dashboard.md` |

**PR:** #68.

---

### P0-05 — Agente de referência

| Stop condition | Status |
|----------------|--------|
| Runbook | **Feito** — `docs/runbooks/reference-agent.md` |
| Loop / métricas públicas | **Operacional** (cron/loop fora do git; treasury devnet local) |
| Números para slide | **Pendente** — atualizar antes da gravação (`audit export --verify`) |

**PR:** #67.

---

### P0-06 — Docs sweep

| Stop condition | Status |
|----------------|--------|
| Tabela inconsistências | **Feito** — README dashboard, ARCHITECTURE, plano, privileged-surface |
| ADR-021 index | **Feito** |
| Sem promessas falsas no README | **Feito** (HIG-01 reforçou README produto) |

**PR:** #69 (merge após rebase com `main`).

---

### P1-01 — F5: Guardian watcher

| Stop condition | Status |
|----------------|--------|
| `scripts/guardian-watch.ts` | **Feito** |
| `pause` em devnet + owner withdraw pausado | **Feito** — script + `guardian-watch-devnet-proof.sh` |
| Runbook | **Feito** — `docs/runbooks/guardian-watch.md` |

**PR:** #70. **CI:** workflow `guardian-watch-devnet.yml` pode falhar se `DEVNET_KEYPAIR` (`5eznzq18…`) estiver sem SOL — ver runbook §7.

---

### P1-02 — F6: Vercel AI adapter

| Stop condition | Status |
|----------------|--------|
| `packages/adapters/vercel-ai` | **Feito** |
| Exemplo + Vitest + README | **Feito** |
| Snippet Cursor | **Feito** — `examples/agent-rails-mcp.cursor.json` |

**PR:** #71.

---

### P1-03 — F8: Alertas

| Stop condition | Status |
|----------------|--------|
| Contract + SDK + MCP denial webhook | **Feito** |
| `alert-watch` headroom | **Feito** |
| Dashboard Settings + i18n | **Feito** |

**PR:** #72. **Runbook:** `docs/runbooks/alert-webhooks.md`.

---

### HIG-01 — Higiene de submissão

| Stop condition | Status |
|----------------|--------|
| Fontes offline (`@fontsource`) + CI `next build` | **Feito** — #73 |
| README produto + open/commercial | **Feito** |
| `colosseum-pre-hackathon-declaration.md` | **Feito** (colar no site = humano) |
| `dashboard-smoke.md` | **Feito** |
| `VERIFY_STRICT=1 verify.sh all` | **Feito** local 2026-09-26* |
| `verify.sh ui` | **Feito** — 45 testes |
| Smoke manual assinado | **Pendente** |

\* `pnpm audit` falha com registry **npmmirror**; com `registry.npmjs.org` → sem vulnerabilidades high. `mutants`/`e2e` não entram em `verify.sh all`.

**PR:** #73.

---

### F7 — Cortado

Landing / waitlist / “Try on devnet” — **fora de escopo** (`colosseum-plano-execucao.md`).

---

## 3. Issues delegáveis (plano)

| # | Item | Status |
|---|------|--------|
| 1 | `ceiling-meter.tsx` | **Feito** — limits, metrics, workflows |
| 2 | Saldos por mint (leitura) | **Feito** |
| 3 | Histórico pagamentos | **Feito** — F2b |
| 4 | Export CSV/JSON | **Feito** — F2b |
| 5 | Webhook alertas | **Feito** — F8 |
| 6 | Passada i18n global | **Parcial** |
| 7 | Smoke 10 passos escrito | **Feito** — runbook; execução humana pendente |

---

## 4. O que não está no `texto.txt` mas está no 10/10

| Item | Status |
|------|--------|
| Cadastro Colosseum / Earn / Brasil | **Pendente** — checklist § Submissão |
| Vídeo pitch + demo EN | **Pendente** |
| Deck 10 slides, GTM no form | **Pendente** |
| 10 conversas gravadas | **Pendente** (Bernardo) |
| 10 regras de negócio em ADR dedicado | **Parcial** — listadas no plano §206–217, não ADR único |
| Declaração pré-14/09 no **site** | Texto pronto em `colosseum-pre-hackathon-declaration.md` |

---

## 5. Verificação local (2026-09-26)

```bash
# Pré-requisito: target/deploy/agent_rails.so (+ test_pda_relay.so)
cargo build-sbf --manifest-path programs/agent_rails/Cargo.toml
cargo build-sbf --manifest-path programs/test_pda_relay/Cargo.toml

VERIFY_STRICT=1 scripts/verify.sh all    # audit: use npmjs registry se npmmirror
VERIFY_STRICT=1 scripts/verify.sh ui     # 45 Playwright tests
```

---

## 6. Atualizar `~/texto.txt`

Substituir a seção “Quick map” no final do arquivo pela versão em `docs/strategy/colosseum-prompt-status.md` (mantida em sync com este relatório) ou copiar a tabela da conversa após merge deste doc.

---

## 7. Próximos passos recomendados

1. Colar `colosseum-pre-hackathon-declaration.md` no formulário Colosseum.  
2. Fundar `5eznzq18…` no devnet → `gh workflow run guardian-watch-devnet.yml`.  
3. Smoke manual → assinar `dashboard-smoke.md`.  
4. Gravar demo/pitch; submeter até **10/10** (prazo real **12/10**).
