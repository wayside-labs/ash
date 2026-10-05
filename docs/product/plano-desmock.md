# Plano — implementar tudo o que hoje é mock, inerte ou reservado

**Origem:** a auditoria de 2026-09-28 (itens 1–3 da conversa). Cada item abaixo remove um mock,
liga uma feature inerte a algo que a consome, ou implementa um campo v1.1 já reservado.

**Regra de ordem:** off-chain primeiro (fases 0–3, sem upgrade de programa), on-chain depois
(fase 4, cada feature com ADR próprio antes de código). Nenhuma fase depende de uma posterior.

## Status de execução (2026-09-28, branch `feat/desmock`)

Decisões aplicadas: **D1** Voyage (sem chave → BM25 real, rotulado "keyword"), **D2** Resend,
**D3** perguntar (esconder vs apagar), **D4** fase 4 **depois** do Colosseum — não iniciada.

| Item | Estado | Desvio do plano |
|---|---|---|
| 0.1 métricas mock | ✅ virou fixture de teste (`lib/metrics/__fixtures__`), sem uso no app | o arquivo alimentava `fold.test.ts`; mover em vez de apagar |
| 0.2 oracle | ✅ 503 antes de faturar; 503 com invoice aberto se falhar após pagamento; cache ≤ 10 min com `as_of` real | — |
| 1.1 skills | ✅ import/download SKILL.md, bundle `.zip`, 5 skills reais no seed (teste de drift), `run-agent.sh --bundle` | `ash agent pull` no CLI **não** feito: o CLI não tem sessão do dashboard hospedado; baixar o zip pela UI cobre o fluxo |
| 1.2 ingestão | ✅ tokens por workflow, `/api/ingest/{events,reviews,knowledge}`, store JSON + Postgres, migration com RLS | — |
| 1.3 canais | ✅ webhook/Slack/Telegram/e-mail, `limitAlerts` e `emailNotifications` valendo, migração do webhook antigo | — |
| 1.4 revisões | ✅ `/reviews`, aprovação por intent id, `REVIEW_REJECTED`, `ash_request_limit_increase` (7ª ferramenta), ADR-022 | — |
| 2.1 canvas | ✅ grafo derivado das linhas; só o layout é salvo (`workflows.canvas_layout`) | coluna jsonb no workflow em vez de recurso `workflowGraphs`: não há grafo a guardar |
| 2.2 gerar com IA | ✅ proposta validada por zod, pré-visualização, aplica pelas rotas normais; `demo` → recusa | — |
| 3 RAG | ✅ `/knowledge`, PDF (unpdf)/Markdown/URL com proteção de SSRF, Voyage ou BM25, `packages/knowledge-mcp`, trechos no chat | ranking em processo (jsonb `real[]`) em vez de pgvector: mesmo código nos dois stores, suficiente até 5 000 trechos por org |
| 4.x on-chain | ⏸ não iniciado (D4) | — |

Migrations novas, a aplicar no Supabase com `supabase db push` (rode `config diff` antes):
`20260929000000_ops_events_reviews.sql`, `20260929010000_workflow_canvas_layout.sql`,
`20260929020000_knowledge.sql`.

---

## Fase 0 — limpeza (meio dia)

| # | Item | Mudança | Pronto quando |
|---|---|---|---|
| 0.1 | `lib/metrics/mock.ts` morto | apagar o arquivo, o ramo `demo` de `payments-table.tsx`, a string `metrics.payments.mockNotice` e o `data-testid="payments-mock"` (ajustar o spec do Playwright que o procura, se houver) | `grep -r "metrics/mock"` vazio; `verify.sh ui` verde |
| 0.2 | Fallback mock do oracle | `ORACLE_ON_UPSTREAM_FAILURE=refuse` (padrão em produção) \| `mock` (só local). Em `refuse`: a criação do invoice checa o upstream antes (sem cobrar nada se estiver fora); se ele cair entre o pagamento e o redeem, o redeem responde **503 retryable** e o invoice **continua aberto** — o redeem é idempotente, então o agente tenta de novo e recebe preço real. Nunca entregar mock para quem pagou em produção | teste: upstream fora → 503, invoice aberto, upstream volta → 200 com `source: coingecko` |

## Fase 1 — o que o dashboard guarda passa a ter consumidor (3–4 dias)

### 1.1 Skills de ponta a ponta

1. **Import** em `/skills`: botão "Importar SKILL.md" (upload ou colar texto); faz parse do
   frontmatter (`name`, `description`) → corpo vira `content`. Validação: nome slug-safe, máx.
   64 KB, sem frontmatter extra executável.
2. **Export**: o runner-config vira um **bundle** `.zip` — `/.mcp.json` + `.claude/skills/<slug>/SKILL.md`
   para cada skill habilitada no escopo (mesma regra de escopo dos MCPs: global + workflow + o
   agente). `GET /api/export/runner-config?format=zip`; `format=json` continua existindo para
   quem só quer o `mcpServers`. Cabeçalho `X-Runner-Skills` com a contagem.
3. **CLI**: `ash agent pull --workflow … --agent … --out <dir>` baixa e descompacta o
   bundle (operador), pronto para `claude -p` rodar dentro de `<dir>`. `run-agent.sh` aceita
   `--bundle <dir>` em vez de montar tudo do repo.
4. **Chat**: *não* injeta skills. Decisão registrada: skills descrevem uso de ferramentas e o
   chat tem zero ferramentas; injetar seria contexto morto e superfície de injeção. Documentar
   em ADR curto (ver 1.4).
5. **Seed**: as 5 skills de `examples/skills/` entram no seed (substituindo as de exemplo),
   marcadas `demo: false`, desabilitadas.

Testes: parser de frontmatter (unit), compilação do bundle por escopo (unit, espelhando
`mcp-config.test.ts`), rota zip (vitest route handler), Playwright: importar → habilitar →
exportar → zip contém o arquivo.

### 1.2 Ingestão de eventos: um endpoint para alertas, revisões e notificações

Hoje os alertas saem do MCP direto para um webhook, e o `review_required` fica num JSONL no
host do agente — o dashboard hospedado nunca vê nenhum dos dois. Um canal resolve os três
itens seguintes:

- **`POST /api/ingest/events`**, autenticado por **token de ingestão por workflow** (gerado no
  dashboard, só o hash fica guardado, rotacionável). Aceita os eventos de
  `@ash/contract/alerts` (`payment_denied`, `headroom_low`) mais dois novos:
  `payment_review_required` e `limit_increase_requested` (1.4).
- MCP: `ASH_EVENTS_URL` + `ASH_EVENTS_TOKEN`, entregue no bundle do export. O
  envio reaproveita a fila não-bloqueante de `alert-webhook.ts` (telemetria fora do ar não
  para pagamento).
- Tabela `events` (migration Supabase + store JSON local), com `org_id`, RLS igual às demais.
- `scripts/alert-watch.ts` ganha a opção de postar no mesmo endpoint.

### 1.3 Integrations = canais de notificação (substitui o toggle morto e o e-mail desligado)

- `integrationSchema` passa a significar **canal**: `kind: webhook | slack | telegram | email`,
  destino, eventos assinados. Página `/settings` → seção "Canais" (a tabela já existe, falta UI).
- Fan-out no servidor ao receber um evento (1.2), respeitando:
  - **`limitAlerts`** → liga/desliga `headroom_low` e `payment_denied` para todos os canais
    (é o que o toggle promete hoje e não faz). Enquanto o MCP ainda posta direto no webhook
    legado, o export **omite** `ASH_ALERT_WEBHOOK_URL` quando o toggle está desligado.
  - **`emailNotifications`** → habilita o canal e-mail; o switch deixa de ser `disabled`.
- E-mail: provedor transacional via API (decisão D2), chave em env do servidor, nunca no
  estado do tenant. Limite de envio por org.
- `alertWebhookUrl` atual é migrado para um canal `webhook` (migration de dados).

### 1.4 Fila de revisão humana (fecha o beco sem saída do `review_required`)

Versão off-chain, que ADR-013 já classifica como controle de fluxo e não fronteira de
segurança (a fronteira real é 4.1):

1. MCP, ao retornar `review_required`, envia `payment_review_required` com o intent completo e
   devolve `review_id` ao agente.
2. Dashboard: página **`/reviews`** — pendentes, aprovar/rejeitar, com quem e quando. Aprovar
   grava uma decisão ligada ao **`intent_id`** (não a um valor ou destino genérico).
3. MCP: no próximo `execute_payment` com os **mesmos argumentos** (mesmo intent id), consulta
   `GET /api/ingest/reviews/{intent_id}` com o token; aprovado e não expirado → segue o
   caminho normal (policy on-chain continua valendo); rejeitado → `denied` `REVIEW_REJECTED`.
   Uma aprovação vale para um intent uma vez.
4. Nova ferramenta `ash_request_limit_increase(reason)` — prevista em ADR-007 para a
   v1.1: **só emite evento**, não concede nada. Aparece em `/reviews` como pedido; quem decide
   aumentar é o operador pelo CLI/dashboard. Atualizar `AGENT_TOOL_NAMES` e o snapshot de
   schemas; `tool-surface.test` continua garantindo que nada privilegiado entrou.
5. ADR-022 registra: fila off-chain, ligação por intent id, por que aprovar não paga (o
   operador não tem a chave da sessão) e que 4.1 é a versão que resiste a host comprometido.

Testes: MCP (in-memory transport) aprovado/rejeitado/expirado/sem-dashboard (fail-closed),
rota com token errado → 401, aprovação reutilizada → recusada.

## Fase 2 — canvas de workflow real (3 dias)

### 2.1 Persistência

- Novo recurso `workflowGraphs` (`workflowId`, `nodes`, `edges`, `updatedAt`) no schema,
  store JSON e Postgres (migration + RLS). Salva com debounce; conflito = último escreve, com
  `updatedAt` para detectar.
- Nós deixam de ser enfeite:
  - soltar **agent** abre o diálogo de criar agente de verdade; o nó guarda `agentId`;
  - soltar **action** exige escolher/criar um MCP; o nó guarda `mcpId` (o `ActionNodeDialog`
    já edita MCPs);
  - **treasury** liga ao `treasuryAddress` do workflow;
  - aresta agente→agente grava `paysTo`/`receivesFrom`; aresta agente→action muda o escopo do
    MCP para aquele agente (ou pergunta).
- Apagar nó pergunta se apaga a entidade ou só a posição.

### 2.2 "Gerar com IA" de verdade

- `POST /api/workflows/generate` usa a mesma pilha de providers do chat (`resolveProvider`,
  sandbox do `claude-cli`, rate limit e `acquireSlot` do chat).
- O modelo recebe o catálogo real (MCPs, skills e agentes do tenant) e devolve **JSON validado
  por zod** — uma *proposta* de nós/arestas referenciando só IDs existentes ou marcados
  `new`. Nada é criado até o usuário aceitar a pré-visualização.
- Nunca propõe nada privilegiado: o schema da proposta não tem campos de limite, sessão ou
  allowlist.
- Provider `demo` → botão desabilitado com tooltip "conecte um modelo" (fim do `if Kamino`).

Testes: validação da proposta (IDs inexistentes, campos extras, JSON inválido → erro legível),
Playwright com a rota stubada.

## Fase 3 — RAG real (4–5 dias; depende da decisão D1)

- Upload em nova página `/knowledge` (pdf, md, url). Extração: md direto, pdf via lib no
  servidor, url com fetch + **proteção de SSRF** (só http(s), sem IP privado/loopback/link-local,
  resolver DNS antes, tamanho e tempo máximos).
- Chunking + embeddings (provedor na D1) → **pgvector** no Supabase (migration, RLS por org);
  local: SQLite + busca linear.
- `status` real: `indexing → indexed | error` com mensagem.
- Consumo:
  - **MCP `ash-knowledge`** (stdio, novo binário no pacote vendors ou próprio), tool
    somente leitura `search_knowledge(query, k)`, escopo por agente, entra no bundle de 1.1;
  - **chat**: top-k trechos do escopo global no contexto, marcados como conteúdo não confiável
    (mesma regra que `system-prompts.ts` já aplica a CSV/contexto).

## Fase 4 — v1.1 on-chain (cada item: ADR → policy crate → programa → IDL/client → SDK/MCP/CLI/dashboard)

Portões de todo item: `tests/layout.rs` prova que só campos reservados mudaram de significado
(sem migração), Kani + proptest + `cargo-mutants` zero sobreviventes no policy crate, CU
dentro do spec §10, `program-security-reviewer` sem achado, `pnpm idl:sync` + `codegen:check`,
upgrade de devnet feito por pessoa (ADR-020).

| # | Feature | Campo já reservado | Mudança | Esforço |
|---|---|---|---|---|
| 4.1 | **`approval_threshold`** (revisão humana on-chain) | `MintLimit.approval_threshold` | nova conta `Approval` PDA `["approval", session, intent_id]` criada por `approve_intent` (operador/guardião); `execute_payment` acima do limiar exige a conta e a fecha. Limiar ≤ teto. A fila 1.4 passa a assinar `approve_intent` com a carteira do operador | 1,5 sem |
| 4.2 | **`cooldown_seconds`** | `MintLimit.cooldown_seconds` + `SpendCounter.last_payment_at` (já existe) | função pura `check_cooldown` no policy crate, `checked_*`, prova Kani; erro novo `CooldownActive` + reason code | 3 dias |
| 4.3 | **Timelock de afrouxamento + veto de guardião** | `Treasury.timelock_seconds` | conta `PendingChange` (ADR-002 opção D): subir limite, adicionar destino, estender sessão viram *propostas* que só aplicam após o prazo; guardião pode vetar; apertar continua instantâneo | 2 sem |
| 4.4 | **`recovery_destination`** | `Treasury.recovery_destination` | withdraw para ele fica isento do timelock (os outros destinos esperam); configurável na criação, trocável só via PendingChange | 2 dias (junto com 4.3) |
| 4.5 | **Modo signed-intent + relayer** | `AgentSession.auth_mode = 1`, `DOMAIN_INTENT` | `execute_payment` aceita prova via instrução Ed25519 (introspecção de sysvar) sobre `DOMAIN_INTENT ‖ program ‖ treasury ‖ session ‖ borsh(intent)`; `intent_id` vira nonce. Novo pacote `relayer` (HTTP, paga as taxas, sem poder sobre o conteúdo) | 2–3 sem |
| 4.6 | **MCP Streamable HTTP** | — (ADR-007 v1.1) | transport HTTP com `TokenSessionResolver` (token → sessão + signer), TLS via Caddy, rate limit; permite hospedar o MCP na VPS e dispensa chave no laptop do agente quando combinado com 4.5 | 1 sem |

Ordem sugerida na fase 4: 4.2 (menor, esquenta o pipeline de upgrade) → 4.1 (fecha 1.4) →
4.3 + 4.4 → 4.6 → 4.5.

---

## Decisões pendentes (suas)

| # | Decisão | Opções | Recomendação |
|---|---|---|---|
| D1 | Embeddings do RAG | Voyage (parceira da Anthropic) · OpenAI · modelo local (bge) | Voyage; local se não quiser outra chave |
| D2 | E-mail | Resend · SMTP próprio · Supabase Auth mailer | Resend (API simples, domínio verificado) |
| D3 | Canvas: apagar nó apaga a entidade? | sempre perguntar · nunca | perguntar |
| D4 | Fase 4 antes do prazo do Colosseum (12/10)? | sim · depois | depois: fases 0–2 cabem antes; upgrade de programa perto da submissão é risco |

## Cronograma aproximado (1 pessoa + Claude)

| Semana | Entrega |
|---|---|
| 1 | Fase 0, 1.1, 1.2 |
| 2 | 1.3, 1.4, Fase 2 |
| 3 | Fase 3 (se D1 decidida) |
| 4–10 | Fase 4, na ordem acima, cada item em PR próprio |

## Testes manuais

Cada fase acrescenta linhas a `docs/runbooks/agent-infra-manual-tests.md` (seções novas J
"Skills/bundle", K "Eventos e canais", L "Revisões", M "Canvas", N "Conhecimento", O "v1.1").
