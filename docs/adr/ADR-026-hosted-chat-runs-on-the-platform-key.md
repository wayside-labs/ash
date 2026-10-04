# ADR-026: Hosted chat runs on the platform key only

**Status:** Accepted — 2026-10-04, by the operator, after production showed both legacy
providers in the hosted picker.

## Context

The chat has had four providers: the local Claude Code CLI, an Anthropic key the user stores
in *My APIs*, the platform's OpenRouter key (metered per org, ADR-017 billing), and a demo.

ADR-017 let a hosted tenant chat on a key of their own, and ADR-019 said the CLI "stays off
for hosted tenants". Nothing in code enforced either. On 2026-10-03 production listed "Claude
Code (your subscription)" to every signed-in visitor, backed by the operator's personal login,
and answered an expired token with `401 OAuth access token is invalid`. A second, separate
confusion followed: the page picked its failure hint from the previous reply's mode, so an
HTTP 502 from in front of the app (no mode, no provider) read "Check your API key in My APIs".

## Options considered

1. **Keep the stored-key path next to the platform key.** A tenant's own key still outranks
   the operator's. Costs the operator nothing, but the picker keeps two paid and one broken
   door, and the support surface is three providers' error modes.
2. **Platform key only when hosted** (chosen). One provider, one meter, one error vocabulary.
3. **Platform key only everywhere.** Would remove the CLI and key paths a self-hosting
   developer uses on their own machine, for no hosted benefit.

## Decision

A hosted install — Supabase configured — lists `openrouter-platform` and `demo` and nothing
else. It does not probe for the CLI and does not read the stored or env Anthropic key.
`resolveProvider` only honours listed providers, so a browser that still remembers a
`claude-cli:*` or Anthropic model falls through to the platform default (Haiku 4.5).

Local JSON mode is unchanged: the CLI and a stored key remain development providers there.

The page's failure hint follows the provider the user selected, never a previous reply's mode,
and an unknown failure says "try again" instead of naming a key.

## Consequences

- A tenant's stored Anthropic key is no longer used by the hosted chat. It is still stored and
  masked, and the *My APIs* page still exists; whether it stays on hosted is a separate call.
- The canvas generator never used the platform key (it has no per-user limit or credit meter),
  so on a hosted install it now has no model until it gets its own metered path.
- Supersedes ADR-017's rule that a visitor with a key of their own chats on it, for the chat
  only. ADR-017's client-held-secrets rules for session keys are untouched.
- The operator's `CLAUDE_CODE_OAUTH_TOKEN` in `dashboard.env` is dead config and can be removed.
