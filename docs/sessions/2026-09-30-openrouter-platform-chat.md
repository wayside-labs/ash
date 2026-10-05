# Session log — 2026-09-30: platform-paid chat through OpenRouter

This log records what was built and the decisions made along the way that a reader would
otherwise have to reconstruct from the diff. The PR is #80 (`feat/openrouter-chat`). The
research that came before it is in `docs/runbooks/openrouter-chat-integration.md`.

## The question that started it

The goal: a chat that hosted users can pay for as a subscription, without ever learning
what an API key is. Before this session the dashboard chat ran on one of three paths: the
user's Claude Code CLI (local only, single-tenant), the user's own Anthropic key, or demo.
None of them works for a signed-in web user with no key.

An earlier research pass (done in another tool) weighed six options: platform OpenRouter,
a direct platform Anthropic key, an AI gateway, self-hosted LiteLLM, a two-tier
BYOK/hosted split, and reselling seats. It recommended platform OpenRouter behind
`/api/chat` as the first step, with billing to follow. That pass also produced the runbook
and a Claude Code prompt ("P2-00"). This session checked both against the code before
building anything.

## What review of P2-00 changed

Three findings from reading the code, each of which changed the implementation:

- **The auth gate was a side effect.** `/api/chat` never checked the hosted session.
  Anonymous callers were stopped only because `buildContext` threw `StateAccessError` on
  unreadable tenant state. For a key that spends the operator's money, that is too
  indirect: a refactor of `buildContext` would open it silently. The route now calls
  `openrouterPlatformAccess()` itself, before the snapshot is built, and
  `app/api/chat/route.test.ts` asserts that the snapshot is never built for a denied
  caller.
- **The rate limit was shared by everyone.** `checkFixedWindow("chat", 20)` has one key for
  all users, so one user could drain it for every tenant. `rate-limit.ts` explains why it
  has no per-caller key: on loopback, keying by IP is fake isolation. That reasoning does
  not apply to an authenticated user id. The platform path adds a
  `chat:platform:<user>` window of 10 per minute. It is still per instance, so it damps
  abuse and does not meter spend.
- **"Fence every turn with `withContextLocalized`" would repeat the snapshot N times.**
  Earlier turns are now fenced with the same `<user_message untrusted="true">` delimiters
  (`fenceUserTurn`), and the snapshot goes once, on the last turn (`fencedHistory`).

One more gap turned up while writing the fence: nothing stopped untrusted text from
closing it. A pasted `</user_message>`, or a RAG excerpt ending in `</dashboard_context>`,
put everything after it outside the fence. `neutralizeFences` escapes the opening `<` of
our own two tag names only, and leaves every other `<` in pasted CSV or HTML alone. This
and the multi-turn fencing apply to the Anthropic path as well, not only OpenRouter.

## Decisions, and why

### The platform key is last before demo

The order is `claude-cli` → `anthropic-api` → `openrouter-platform` → `demo`. A key the
user brought is paid by them, and the platform key is paid by the operator, so any BYO
path wins. An explicit model choice still overrides the order.

### Local JSON mode needs no session

There are no sessions without Supabase. Setting `OPENROUTER_API_KEY` there is the operator
opting in for whoever can reach the server, which is how `ANTHROPIC_API_KEY` already
behaves. `.env.example` says so.

### `fetch` + SSE, no SDK

The wire format is small and OpenAI-compatible, and `anthropic-api.ts` already records
what a transitive dependency tree cost this repo in advisories. The parser skips
OpenRouter's `: OPENROUTER PROCESSING` comment lines. It also treats an `error` chunk
after the 200 as a failure, because OpenRouter reports mid-stream failures that way
rather than with a status code.

### Two models, Claude-class only, prefixed ids

`anthropic/claude-sonnet-5.5` (default) and `anthropic/claude-haiku-4.5`, checked against
OpenRouter's live `/api/v1/models`. The prompt defences (Broken Record, fences, security
footer) are instructions to the model and not enforcement, so they hold only as well as
the model follows its system prompt. That rules out a free model picker. The ids carry an
`openrouter:` prefix so `resolveProvider`'s match-by-model-id can never confuse them with
`anthropic-api`'s `claude-sonnet-5`.

### What leaves for OpenRouter

- No `tools` field, the same as every other path.
- `user` is a SHA-256 prefix of the auth uuid, stable enough for per-user abuse isolation,
  never the id itself.
- `X-OpenRouter-App-Visibility: hidden` is set. `HTTP-Referer` is sent only when
  `OPENROUTER_SITE_URL` is set, so no default URL gets baked in.

Errors go the other way: users see localized text only (`llm.error.platform*`). The
upstream message concerns the operator's account (credits, keys) and is logged on the
server.

### Deviations from the runbook

- No `OPENROUTER_ENABLED` or `OPENROUTER_DEFAULT_MODEL`: the key's presence is the switch,
  and the default is the first allowlisted model.
- `complete.ts` is not touched, because it does not exist on `main`. It lives on the
  unmerged wave-2A branch and needs this provider once both land.
- `e2e/fixtures.ts` is unchanged: it stubs `/api/chat` as demo, and the only new UI is a
  badge.

## Verification

- `pnpm --filter @ash/dashboard test`: 170 passed. New files:
  `openrouter-api.test.ts` (SSE split across reads, comments, `[DONE]`, request shape,
  allowlist refusal before any fetch, 402 mapping, mid-stream error), `prompt.test.ts`,
  `providers.test.ts` (the CLI probe is mocked, since the developer's machine may have
  Claude Code installed), and `app/api/chat/route.test.ts`.
- `tsc --noEmit` and `biome check` are clean. `TextDecoderStream` in `pipeThrough` failed
  the DOM lib typing, so the parser uses a plain `TextDecoder`.
- `scripts/verify.sh ui`: 45 passed.
- **Not verified: a live call.** No OpenRouter account exists yet.

## Open after this session

- Billing: Stripe, a per-org usage ledger from the stream's `usage` chunk, and an
  entitlement check before `openrouterPlatformAccess` grants access. Until then, any
  signed-in user can spend the key within the rate limits, so the spend cap on the key is
  the real ceiling.
- `complete.ts` parity once wave 2A merges.
- A red-team pass against the two allowlisted models: ignore-instructions, a fake closing
  tag, a poisoned RAG excerpt, and a multi-turn bypass. The fences are now structurally
  sound, but whether the model honours the rules inside them is still a property of the
  model.
- The post-merge operator steps are in the PR description.
