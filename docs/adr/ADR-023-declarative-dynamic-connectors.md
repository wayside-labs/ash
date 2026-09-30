# ADR-023: Dynamic connectors are declarative bundles, mounted by a Python FastMCP host

**Status:** Proposed

## Context

Operators describe workflows in chat ("check Tokyo weather every morning and buy forecast
credits if rain is likely") that need data from HTTP APIs no enabled MCP covers. Until now the
chat could only answer `CAPABILITY_GAP` and stop, and adding an API meant someone writing and
packaging an MCP server by hand.

Two things were asked for: the chat should be able to build an MCP for a workflow when one is
missing, and operators should be able to import a file (OpenAPI, a tool description, markdown)
and get an MCP from it. The same request asked for the agentic/MCP layer to move to Python.

What must not change (ARCHITECTURE.md, ADR-021, ADR-022): the agent-facing surface has no
privilege-escalating tools, the payment path is `execute_payment*` through `IntentReceipt`, and
the chat holds no key and executes nothing.

## Options considered

- **A. The model writes MCP server code; a sandbox runs it.** Most expressive. Needs a runtime
  sandbox (Firecracker, e2b) the project does not operate, and turns every chat reply into
  code review: a generated server on the operator's runner sits next to the payment MCP's
  signer and ingest token.
- **B. The model (or an import) writes a declarative bundle; one audited host mounts it.** A
  bundle is data — URL templates, parameter schemas, env *names* — validated by a schema
  before anything runs. Less expressive: no custom logic, HTTP/JSON only.
- **C. Rewrite the payment MCP, SDK and CLI in Python** so the whole agent layer is one
  language. Loses the Codama-generated client, the contract package every surface shares,
  and the MCP contract tests; re-audits the one path that moves money, for no gain in what
  connectors can do.

## Decision

**B**, with the connector host in **Python** (`services/connector-host`, `mcp` SDK's FastMCP)
and the payment rail staying in TypeScript. Python is where the dynamic, fast-moving part
lives; the audited part does not move (rejects C).

- **Bundle v1** (`agent-rails.connector/v1`) is defined twice — Zod in
  `@agent-rails/contract/connector-bundle`, Pydantic in the host — and pinned together by
  `examples/connectors/fixtures/`, which both test suites load. An import format is converted
  by both sides and compared to a committed `*.expected.json`.
- **Refused by schema, on both sides:** tool names containing a governance or key term
  (`session`, `policy`, `withdraw`, `pause`, `allowlist`, `sign`, `keypair`, `seed`,
  `execute_payment`, …, matched per token); env names with the `AGENT_RAILS_`, `SOLANA_` or
  `CONNECTOR_` prefix; unknown fields (so `privilege: elevated` is invalid, not ignored).
- **The host reads only the env names its bundle declares.** The runner's process env —
  which holds the payment server's signer and the ingest token — is never visible to a tool.
- **Outbound calls:** https only, no redirects followed, hosts resolving to non-public
  addresses refused, 1 MB response cap, optional `CONNECTOR_ALLOWED_HOST_SUFFIXES`. Every reply
  carries a fresh `vendor_reference_id` for the payment memo.
- **One write path.** File import, the chat's `connector-bundle` fence, and the canvas
  generator's `connectors` all go through `POST /api/connectors/import`, which re-validates.
  A key pasted into a bundle is moved to the MCP row's masked `env` and blanked in the bundle.
- **The chat still executes nothing.** It emits a draft; a person clicks *Add connector*.
- Accepted import formats: bundle (`.yaml/.json`), OpenAPI 3 (`.yaml/.json`), markdown with
  bundle frontmatter (`.md/.mdx`, body → MCP instructions). Postman and GraphQL are
  recognised and refused by name (phase 2).

## Consequences

- A workflow gains a read/quote tool in one click, without code or a sandbox.
- Connectors cannot express logic beyond one HTTP request per tool; anything needing it is a
  hand-written MCP, reviewed as code.
- Two schema implementations to keep in step. The shared fixtures make a one-sided change fail
  a test; they do not stop someone changing both sides wrongly.
- Runners need `uv tool install ./services/connector-host` (the exported config spawns
  `agent-rails-connector`); the bundle travels inline as `CONNECTOR_BUNDLE_JSON`, so a hosted
  dashboard and the operator's machine share no paths.
- DNS rebinding between the address check and the connection is not closed; the host-suffix
  allowlist is the stronger control and hosted deployments should set it.
- A new `mcp_servers.connector jsonb` column (migration `20260930010000`); rows are written
  without it when unset, so an unmigrated deployment keeps working until the first import.
