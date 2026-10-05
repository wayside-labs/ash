# /pitch e /investidor — plano de implementação

> Execução inline nesta sessão (Lucas delegou: "pode fazer tudo"). Spec:
> `docs/plans/2026-09-30-pitch-investidor.md`. Cada tarefa termina com `pnpm test` verde e commit.

**Goal:** um deck de pitch único desenhado em `/pitch` e `/investidor` (EN/PT), com funil de
lead no segundo (popup → boas-vindas → deck), gravando no D1 e repassando ao Listmonk.

**Architecture:** conteúdo em `src/content/pitch.{en,pt}.ts`; lógica pura em `src/lib/`
(testada no vitest); componentes Astro em `src/components/pitch/`; a Pages Function
`functions/api/lead.ts` só adapta `Request`/`env` para `handleLead()`.

**Tech Stack:** Astro 7 (estático), TypeScript, vitest, Playwright, Cloudflare Pages Functions +
D1 + Turnstile, Listmonk v6 (API REST) atrás de túnel + Cloudflare Access.

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/content/pitch.en.ts` / `pitch.pt.ts` | Telas (linha, apoio, notas, duração), textos do deck, popup, boas-vindas |
| `src/content/pitch.ts` | `getPitch(lang)`, tipos, rotas (`pitchPath`, `investorPath`) |
| `src/lib/deck-model.ts` | Estado puro do deck: `clamp`, `next`, `prev`, `fromHash`, `schedule(durations)` |
| `src/lib/lead-schema.ts` | `validateLead(input)` → `{ ok, lead }` ou `{ ok: false, errors }` (navegador e função) |
| `src/lib/lead-handler.ts` | `handleLead(body, deps)`: Turnstile → upsert D1 → Listmonk → reenvio de pendentes |
| `src/lib/visitor.ts` | `loadVisitor()`/`saveVisitor()` no `localStorage`, sempre em `try/catch` |
| `src/components/pitch/Deck.astro` | Desenha as telas + controles; script liga teclado/clique/toque/hash/autoplay/notas |
| `src/components/pitch/Gate.astro` | Popup do formulário (+ Turnstile) |
| `src/components/pitch/Welcome.astro` | "Olá, <nome>" + frase por tipo + cena do teto com o nome no cofre |
| `src/pages/pitch.astro`, `pt/pitch.astro` | Deck aberto |
| `src/pages/investor.astro`, `pt/investidor.astro` | Gate → Welcome → o mesmo Deck |
| `functions/api/lead.ts` | Adaptador da Pages Function |
| `migrations/0001_leads.sql` | Tabela `leads` |
| `wrangler.toml` | `pages_build_output_dir`, binding D1 |
| `scripts/leads-sync.mjs` | Reenvia `pending` ao Listmonk via API do D1 (manual) |
| `src/layouts/Base.astro` | Props novas `altPath`, `noindex`, `motion` |
| `astro.config.mjs` | Sitemap sem as rotas de pitch |
| `src/content/copy.{en,pt}.ts` | Política de privacidade com a seção do formulário |

## Tarefas

### 1. Base e sitemap
- `Base.astro`: `altPath?` (default: regra atual), `noindex?` → `<meta name="robots"
  content="noindex, nofollow">`, `motion?` (default `true`; `false` não chama `initMotion`).
- `astro.config.mjs`: `sitemap({ filter: (p) => !/\/(pt\/)?(pitch|investor|investidor)\/?$/.test(new URL(p).pathname) })`.
- Verificar: `pnpm build`, `dist/sitemap-0.xml` não contém `pitch`.

### 2. `deck-model` (TDD)
Testes em `tests/unit/deck-model.test.ts`:
- `clamp(-1, 12) === 0`, `clamp(99, 12) === 11`.
- `next(11, 12) === 11`, `prev(0, 12) === 0`, `next(3, 12) === 4`.
- `fromHash("#3", 12) === 2` (1-based no hash), `fromHash("", 12) === 0`, `fromHash("#abc", 12) === 0`, `fromHash("#40", 12) === 11`.
- `schedule([10, 20, 30])` → `[0, 10, 30]` (segundo em que cada tela começa); `total([..]) === 60`.

### 3. Conteúdo do pitch + paridade (TDD)
- `tests/unit/pitch.test.ts`: mesmas chaves EN/PT; 12 telas; soma das durações = 180 s; nenhuma
  string vazia; nenhuma casa `/\$\s?\d|R\$\s?\d|non-custodial|não custodial|TODO/i`.
- Escrever `pitch.en.ts`/`pitch.pt.ts` com as 12 telas da spec, notas de fala (~450 palavras
  somadas no EN) e fontes em comentário.

### 4. `lead-schema` (TDD)
`tests/unit/lead-schema.test.ts`: aceita um lead completo; recorta espaços; rejeita nome vazio,
nome > 80, tipo fora do enum, e-mail sem `@`/sem domínio, e-mail > 254, consentimento ausente ou
`false`, idioma fora de `en|pt`; e-mail vira minúsculo.

### 5. `lead-handler` (TDD)
`tests/unit/lead-handler.test.ts` com `db` falso (grava as queries) e `fetch` falso:
- Turnstile `success: false` → `{ status: 400 }` e nada gravado.
- Corpo inválido → 400 com `errors`.
- Válido sem `LISTMONK_URL` → upsert com `listmonk_status = 'pending'`, 200.
- Válido com Listmonk 200 → `'sent'`; Listmonk 409 (já existe) → `'sent'`; Listmonk 500 ou
  exceção → `'pending'`, resposta ainda 200.
- Com Listmonk ok, reenvia até 5 `pending` antigos e marca `'sent'`.
- Requisição ao Listmonk leva `Authorization: Basic`, `CF-Access-Client-Id/Secret`, corpo com
  `lists: [LISTMONK_LIST_ID]`, `preconfirm_subscriptions: false`, `attribs`.

### 6. Função, migração, wrangler
- `migrations/0001_leads.sql` (`email` UNIQUE).
- `functions/api/lead.ts`: `onRequestPost` → `handleLead(await request.json(), { db: env.DB, fetch, env })`;
  JSON inválido → 400; métodos ≠ POST → 405 (roteamento padrão da Pages).
- `wrangler.toml`: `name = "ash-web"`, `pages_build_output_dir = "dist"`, `[[d1_databases]]
  binding = "DB"`.

### 7. Deck
- `Deck.astro` recebe `lang`, desenha `<section class="slide" data-slide>` por tela, barra de
  progresso, contador, botões anterior/próxima, painel de notas (oculto).
- Script: teclado (←/→/espaço/PageUp/PageDown/Home/End, `P` autoplay, `N` notas), clique na
  metade direita/esquerda, toque (deslize > 40 px), `hashchange`, `aria-live` no contador.
- `pitch.astro`/`pt/pitch.astro` com `noindex` e `motion={false}`.

### 8. Gate + Welcome + rotas do investidor
- `Gate.astro`: `<dialog>` aberto no carregamento, form com os 4 campos + consentimento +
  Turnstile (`data-sitekey` de `PUBLIC_TURNSTILE_SITEKEY`; sem chave, o widget não carrega e a
  função, sem secret, recusa — em dev o e2e intercepta a API). Erros por campo.
- Envio: `validateLead` no navegador → `POST /api/lead` → `saveVisitor({ name, kind })` →
  esconde o gate, mostra `Welcome`.
- `Welcome.astro`: título com o nome, frase por tipo, canvas montado por `mountCeilingScene` com
  `balance` = rótulo com o nome, botão "Ver o pitch" que revela o `Deck`.
- Visitante salvo → pula o gate, "Olá de novo".
- `investor.astro` / `pt/investidor.astro`, `altPath` cruzado.

### 9. e2e
`tests/e2e/pitch.spec.ts`:
- `/pitch`: → avança, `End` vai à 12, `#3` abre a 3; sem overflow em 390 px.
- `/investor`: gate visível, deck oculto; enviar sem consentimento mostra erro; com
  `page.route("**/api/lead", …)` → 200, aparece "Hi, Ana"; clicar em "See the pitch" mostra o deck.
- Textos de todas as telas em `/investor` == `/pitch` (e em PT).
- `meta[name=robots]` = `noindex, nofollow` nas quatro rotas.

### 10. Privacidade
Nova seção nas duas políticas (spec §Privacidade) + análise das nove perguntas em
`agenttokenfy/.aios/research/2026-09-30-privacy-investidor.md`.

### 11. Infra e deploy
`wrangler d1 create ash-leads`, aplicar migração, widget Turnstile, secrets da Pages, deploy com
`PUBLIC_BOOKING_URL= PUBLIC_CONTACT_EMAIL=`. Listmonk (usuário de API, lista double opt-in,
túnel + Access) quando houver acesso à VPS; sem ele, leads ficam `pending` no D1.
