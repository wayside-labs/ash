# OpenRouter — dashboard chat integration (research)

**Status:** research / pre-implementation  
**Scope:** `packages/dashboard` hosted + local chat (`/api/chat`), not agent MCP  
**Accounts:** subscribe OpenRouter (and optional Stripe) **after** code lands; this doc lists what to buy and configure.

---

## 1. Goal

Add a **platform-hosted** LLM path so signed-in users can chat **without** Claude Code on the server or an Anthropic key in **My APIs**, while keeping today’s BYO paths:

| Path | Who pays | When |
|------|----------|------|
| `claude-cli` | User’s Claude subscription | Local dashboard only |
| `anthropic-api` | User’s Anthropic key (My APIs / env) | Local or hosted |
| **`openrouter-platform`** (proposed) | Agent Rails OpenRouter account | Hosted default; optional local dev |
| `demo` | Nobody | No key / no entitlement |

Future subscription billing (Stripe) gates **`openrouter-platform`**; billing is **not** in scope for the first PR — only env-gated platform key + provider wiring.

---

## 2. OpenRouter documentation (read before coding)

| Topic | URL | Use in Agent Rails |
|-------|-----|-------------------|
| Quick start / OpenAI-compatible API | https://openrouter.ai/docs/quickstart | Same shape as most adapters |
| Chat completions | https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion | `POST /api/v1/chat/completions` |
| API overview (types, streaming) | https://openrouter.ai/docs/api_reference/overview | Parser design |
| Streaming (SSE) | https://openrouter.ai/docs/api_reference/streaming | Match `text/plain` stream to UI |
| Errors (incl. mid-stream) | https://openrouter.ai/docs/api_reference/errors-and-debugging | HTTP 200 + SSE `error` chunks |
| App attribution | https://openrouter.ai/docs/app-attribution | `HTTP-Referer`, `X-OpenRouter-Title` |
| User tracking | https://openrouter.ai/docs/cookbook/administration/user-tracking | `user` field per org/account |
| Privacy / logging | https://openrouter.ai/docs/guides/privacy/data-collection | Defaults OK; turn off product training |
| Models list | https://openrouter.ai/models | Allowlist in code, not free-form UI |
| Provider routing | https://openrouter.ai/docs/guides/routing/provider-selection | Optional `:nitro`, `provider.sort` |

**Endpoint:** `https://openrouter.ai/api/v1/chat/completions`  
**Auth:** `Authorization: Bearer <OPENROUTER_API_KEY>`  
**Streaming:** `stream: true` → SSE `data: {...}` lines, terminal `[DONE]`, usage chunk before `[DONE]` (OpenRouter deviates from OpenAI — see streaming doc).

**Recommended request headers (production):**

```http
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
HTTP-Referer: https://agent-rails-virid.vercel.app
X-OpenRouter-Title: Agent Rails Dashboard
X-OpenRouter-App-Visibility: hidden
```

Use `hidden` if you do not want a public OpenRouter app page; still send `HTTP-Referer` for support/analytics.

**Optional body fields:**

- `user`: stable hashed org or account id (hosted Supabase) — isolates abuse per tenant on OpenRouter.
- `max_tokens`: keep aligned with `anthropic-api.ts` (8192 cap for chat).
- `stream_options: { include_usage: true }` if you log tokens for future billing.

**Do not enable:** `tools` / `tool_choice` on this route — chat must stay read-only by construction (`context.ts`, `claude-cli` sandbox).

---

## 3. Accounts and subscriptions (after implementation)

| Service | Purpose | When to subscribe |
|---------|---------|-------------------|
| **OpenRouter** | Platform model spend | Before first hosted smoke test |
| **Stripe** (later) | End-user subscription | When gating `openrouter-platform` by plan |
| **Anthropic direct** (optional) | Fallback or A/B vs OpenRouter | Not required if all models go through OpenRouter |

**OpenRouter setup checklist:**

1. Create account → **Keys** → create **production** key (separate key for local dev optional).
2. Add payment method / credits (402 `PaymentRequired` if balance empty).
3. **Privacy:** leave “OpenRouter use of inputs/outputs” **off** unless you explicitly want the 1% discount.
4. **Observability:** optional private logging for debugging; treasury chat may contain workflow names — treat as sensitive.
5. Pick **1–2 allowlisted models** for v1 (e.g. `anthropic/claude-sonnet-4`, `anthropic/claude-3.5-haiku` — verify exact ids on `/models` at implementation time).
6. Set **spend limit** / alerts in OpenRouter dashboard before exposing to users.

**Resale / ToS:** Hosted chat where **you** pay OpenRouter and charge users a flat fee is standard SaaS; document in privacy policy that prompts go to OpenRouter → upstream providers. Not legal advice — review OpenRouter ToS before launch.

---

## 4. Repository infrastructure map

### 4.1 Code touchpoints (implementation order)

| Layer | File(s) | Change |
|-------|---------|--------|
| Stream adapter | `src/lib/server/llm/openrouter-api.ts` **new** | `fetch` + SSE parser → `AsyncGenerator<string>` (mirror `anthropic-api.ts`) |
| Provider registry | `src/lib/server/llm/providers.ts` | `ProviderId`, `openrouterApiKey()`, `listProviders`, `resolveProvider` priority |
| Route | `src/app/api/chat/route.ts` | Branch like `anthropic-api`; same `buildContext`, `getSystemPrompt`, `acquireSlot` |
| Non-stream caller | `src/lib/server/llm/complete.ts` | Canvas generator parity |
| UI types | `components/chat/model-selection.ts`, `hooks/use-dashboard.ts` | Extend provider union |
| UI | `chat-panel.tsx`, i18n `en.json` / `pt-BR.json` | Badge + model group |
| E2E | `e2e/fixtures.ts` | Stub `openrouter-platform` like anthropic |
| Env | `.env.example`, `docs/runbooks/deploy-vercel.md` | Document vars |
| Docs | `packages/dashboard/README.md` § Chat | Provider table |

**Optional (phase 2):** My APIs provider `"OpenRouter"` for BYOK — matches your wireframe (`MY API'S` / Anthropic + OpenAI cards). Platform key would live only in **server env**, not in `dashboard.json`.

### 4.2 Environment variables

| Variable | Where | Notes |
|----------|-------|-------|
| `OPENROUTER_API_KEY` | Vercel + local `.env.local` | Server-only; never `NEXT_PUBLIC_*` |
| `OPENROUTER_SITE_URL` | Optional | Defaults to production URL for `HTTP-Referer` |
| `OPENROUTER_APP_TITLE` | Optional | Default `Agent Rails Dashboard` |
| `OPENROUTER_DEFAULT_MODEL` | Optional | Fallback model id |
| `OPENROUTER_ENABLED` | Optional | `true` on Vercel; off locally if unset |

Hosted resolution proposal:

1. If `OPENROUTER_API_KEY` set **and** (`OPENROUTER_ENABLED` or Supabase session present) → prefer `openrouter-platform` over demo.
2. Local: keep current order (CLI → Anthropic BYOK → OpenRouter if key → demo).

Do **not** store platform OpenRouter key in Supabase until passkey/encryption story exists (see `state/map.ts` hosted secrets note).

### 4.3 Deployment (Vercel)

From `docs/runbooks/deploy-vercel.md`:

- Chat route already `maxDuration = 120` — within Vercel Pro limits; hobby may cap lower (verify plan).
- Region `gru1` — latency to OpenRouter US/EU is acceptable for streaming.
- Add env vars in Vercel project settings; redeploy.
- `ALLOWED_ORIGINS` must include production URL (CSRF on `POST /api/chat`).

### 4.4 Hosted auth (ADR-017)

Today `/api/chat` does **not** call `hostedSessionDenied()` — only `stateAccessResponse` for tenant snapshot. For platform spend, **require** authenticated hosted session before using `OPENROUTER_API_KEY` (otherwise anyone who can hit your origin burns credits). Wire:

- `hostedSessionDenied()` or org membership check when `openrouter-platform` would be selected.
- Local JSON mode: platform key only if operator explicitly sets env (dev).

### 4.5 Rate limits and cost

Existing:

- `checkFixedWindow("chat", 20)` — global per instance.
- `acquireSlot("chat")` — concurrency cap.

Add later (not blocking first PR):

- Per-org counters in Supabase or Redis.
- Log `usage` from final SSE chunk → table for Stripe metered billing.

### 4.6 Dependency strategy

**Prefer `fetch` + SSE** in `openrouter-api.ts` (no new npm package) — same rationale as `@anthropic-ai/sdk` (minimal deps). OpenRouter’s official TS SDK exists but adds another dependency tree; only adopt if parsing becomes painful.

### 4.7 Prompt-injection / security (OpenRouter-specific)

Structural safety **unchanged**: no tools on chat.

Prompt policy (`system-prompts.ts`, `prompt.ts`) is **model-dependent**. For OpenRouter:

- Allowlist **Claude-class** models first; avoid cheap models in v1.
- **Fence every user turn** in history, not only the last message (known gap for `anthropic-api` today — fix in same PR).
- Pass `user: <orgId>` for abuse isolation.

See prior analysis: Broken Record is best-effort, not enforcement.

---

## 5. Message shape (must match current chat)

Mirror `anthropic-api` path:

```ts
system: getSystemPrompt(locale)  // includes security footer
messages: [
  ...priorTurns,  // each user content should use withContextLocalized or fenced wrapper
  { role: "user", content: withContextLocalized(locale, context, lastUserMessage) },
]
```

OpenRouter accepts `role: "system"` as first message **or** separate — use one consistent approach (first message `system` is OpenAI-compatible and works on OpenRouter).

**Streaming to client:** keep `content-type: text/plain; charset=utf-8` and header `x-agent-rails-mode: openrouter-platform` for UI badge.

---

## 6. Testing plan

| Layer | What |
|-------|------|
| Unit | SSE parser: content deltas, usage chunk, mid-stream error, `[DONE]` |
| Unit | `resolveProvider` priority with mocked env / providers |
| Vitest | Provider list includes openrouter when key present |
| Manual | `curl -N` streaming against local dev with real key |
| Manual | Jailbreak strings → expect Broken Record **sometimes** (document flakiness) |
| E2E | Stub OpenRouter in Playwright; no live key in CI |
| Hosted smoke | One message on Vercel after key + auth gate |

**CI:** never commit `OPENROUTER_API_KEY`; use GitHub/Vercel secrets only.

---

## 7. Related internal docs

| Doc | Relevance |
|-----|-----------|
| `packages/dashboard/README.md` | Chat provider stack |
| `packages/dashboard/CLAUDE.md` | Chat must not escalate privilege |
| `docs/runbooks/deploy-vercel.md` | Env + Supabase |
| `docs/adr/ADR-017` | Tenancy |
| `docs/research/revenue-model-analysis.md` | Hosted SKU in separate cloud repo long-term |
| `~/texto.txt` | Prompt format for Claude Code sessions |

---

## 8. Claude Code prompt (Anatomy format)

Copy into a **new Claude Code session** after pulling latest `main`. Suggested id: **P2-00**.

---

### P2-00 — Dashboard chat: OpenRouter platform provider

**Role**  
Senior full-stack engineer on Agent Rails (`packages/dashboard`). You know Next.js 15 App Router, the chat route’s provider stack (`src/lib/server/llm/`), Vitest, Playwright stubs, and the rule that **chat never gets payment tools or MCP**.

**Task**  
Implement a new chat provider **`openrouter-platform`**: server-held `OPENROUTER_API_KEY`, streaming via OpenRouter’s `POST /api/v1/chat/completions`, integrated into `/api/chat` and `complete.ts` with the **same** system prompt, context snapshot, rate limits, and concurrency slots as `anthropic-api`. Gate platform usage on **hosted auth** when Supabase is configured; keep local JSON mode working with env-only key for dev.

**Context**  
- Read `docs/runbooks/openrouter-chat-integration.md` (this file) and OpenRouter streaming + errors docs linked in §2.  
- Mirror `anthropic-api.ts` (`AsyncGenerator`, `max_tokens: 8192`, abort `signal`). Prefer **`fetch` + SSE parser** over a new SDK dependency unless justified.  
- `providers.ts`: extend `ProviderId`, `listProviders`, `resolveProvider` — hosted/Vercel should not fall back to demo when `OPENROUTER_API_KEY` is set and user is authenticated.  
- `route.ts`: new branch; headers `HTTP-Referer`, `X-OpenRouter-Title`, `X-OpenRouter-App-Visibility: hidden`; optional `user` = org/account id from hosted session.  
- **Security:** no `tools` in request body; subprocess `claude-cli` path unchanged.  
- **Prompt injection hardening:** wrap **every** user turn in the chat history with `withContextLocalized` (or equivalent fence), not only the last message — same for `anthropic-api` branch.  
- Allowlist **2 models** in code (constants file); UI model picker reads from `listProviders`.  
- i18n en + pt-BR for provider label, badge, errors (402 payment, 429 rate).  
- Update `.env.example`, `packages/dashboard/README.md` § Chat, stub in `e2e/fixtures.ts`.  
- Do **not** add Stripe or Supabase billing tables in this PR.  
- Run `pnpm format`; `pnpm --filter @agent-rails/dashboard test`; fix any broken types in `model-selection.test.ts`.

**Reasoning**  
OpenRouter is an **OpenAI-compatible transport**; Agent Rails’ product value is the **treasury context + security footer**, not another Anthropic SDK. Platform key on Vercel enables “chat without API keys” for hosted users while BYO Anthropic/CLI remain for power users. Auth gating prevents anonymous credit burn. Fencing all user turns closes a multi-turn injection gap that affects every API provider, including OpenRouter. Keep the diff minimal and provider-shaped like existing code — no billing framework yet.

**Stop conditions**  
- With `OPENROUTER_API_KEY` in `.env.local` and Supabase **disabled**, local chat streams real model text; `x-agent-rails-mode: openrouter-platform`.  
- With key unset, behavior unchanged (CLI → Anthropic BYOK → demo).  
- With Supabase **enabled**, unauthenticated `POST /api/chat` does **not** use platform key (401/403 or demo — pick one and document).  
- `pnpm --filter @agent-rails/dashboard test` green; Playwright suite still passes with stubbed provider.  
- No new dependency with known advisory baggage without comment.  
- README documents env vars and manual smoke (`curl` or one chat message).  
- **No secrets** in git.

**Output**  
One PR: new `openrouter-api.ts`, provider wiring, optional multi-turn fence fix, i18n, tests for parser + `resolveProvider`, doc/env updates. End with a short **“Post-merge operator steps”** list: create OpenRouter account, add key to Vercel, set spend alert, run one hosted smoke message.

---

## 9. Post-merge operator steps (for you)

1. Merge PR.  
2. OpenRouter: create key, add credits, set spend cap.  
3. Vercel: `OPENROUTER_API_KEY`, `OPENROUTER_ENABLED=true`, referer URL.  
4. Sign in on production → send one chat message → confirm badge and streaming.  
5. OpenRouter dashboard: confirm request metadata and token usage.  
6. (Later) Stripe product + org entitlement column → gate platform provider.
