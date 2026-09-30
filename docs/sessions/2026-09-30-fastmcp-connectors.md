# Session log — 2026-09-30: the chat builds MCPs for a workflow

What was built, over two working sessions, and the decisions taken along the way that a
reader would otherwise have to reconstruct from the diff. ADR-023 records the decision that
binds the project; this records the ones that bound the work.

## The two sessions

**Session 1 (design, Cursor).** The question was whether FastMCP could be the connection
layer: operators import a file (which formats?) and get an MCP, and when an operator asks the
chat for a workflow, the chat generates any MCP the workflow is missing. The request also
asked for the agentic and MCP infrastructure to move to Python. That session answered the
format question, chose declarative bundles over model-written code, and left a scaffold:
`services/connector-host/` (a FastMCP stdio host, two tests), `examples/connectors/sample-weather.yaml`,
and `docs/runbooks/fastmcp-connector-layer.md` with six implementation prompts (MCP-P0-00 → 05)
in the "anatomy of a Claude prompt" pattern.

**Session 2 (implementation, Claude Code).** Read the scaffold and the prompts, then
implemented P0-00 → P0-03, part of P0-04, and a canvas path the prompts did not have. The
scaffold was mostly rewritten; the reasons are below, because two of them were security
bugs.

## What landed

- **`services/connector-host`** — `agent-rails-connector`, a FastMCP stdio server that mounts
  one connector bundle: from `--bundle <file>` (bundle, OpenAPI 3, or markdown with
  frontmatter) or inline from `CONNECTOR_BUNDLE_JSON`. `--check` validates and prints the
  normalized bundle. 37 pytest tests, including a real stdio client round-trip.
- **`@agent-rails/contract/connector-bundle` and `/connector-import`** — the same schema and
  importers in Zod, pure (no YAML dependency), so the browser can use them.
- **`examples/connectors/fixtures/`** — `valid/`, `invalid/` (15 refusal cases) and `import/`
  (an OpenAPI and a markdown source, each with the `*.expected.json` both importers must
  produce). Both test suites load these files; this is the drift test.
- **Dashboard**
  - `POST /api/connectors/import`: the one write path.
  - *Import connector* on `/mcps`, with a connector badge on the MCP card.
  - Chat: a Connector Builder section in the system prompt (en + pt-BR) plus footer refusals.
    The chat panel shows each ```` ```connector-bundle ```` block as an *Add connector* card.
  - Canvas: *Generate with AI* proposals gain `connectors[]`.
  - Runner export: connector rows get `CONNECTOR_BUNDLE_JSON`.
  - Migration `20260930010000_mcp_connector_bundle.sql` adds `mcp_servers.connector jsonb`.
- **Gates** — `scripts/verify.sh py` and a `connector host (python)` CI job under
  `VERIFY_STRICT=1`.
- **ADR-023** (Proposed).

## Decisions, and why

### Python for connectors only, not for the payment rail

The request asked for Python across the whole agentic layer. Only the connector host moved.
The payment MCP, SDK and CLI stay in TypeScript. Moving them buys connectors nothing, costs
the Codama-generated client and the contract package every surface shares, and re-audits the
only code that moves money. ADR-023 lists this as option C and rejects it; it is Proposed so
the owner can overturn it.

### Declarative bundles, never model-written code

A bundle is data: URL templates, a JSON-schema subset, and env *names*. Model-written server
code would need a sandbox the project does not run. It would also execute on the operator's
runner, next to the payment server's signer. The cost is expressiveness: one HTTP request per
tool and no logic between calls. A connector that needs more is a hand-written MCP, reviewed
as code.

### Two schemas, one set of fixtures

The Python host has to validate what it mounts, and the dashboard has to validate what it
stores, so the schema exists twice. Nothing in the type systems ties the two together. What
ties them is `examples/connectors/fixtures/`, loaded by both vitest and pytest. The OpenAPI
importer is held to a committed expected output rather than to "looks similar". A rule added
on one side only fails the other side's fixture test. Changing both sides the same wrong way
is not caught; review is still needed for that.

### Governance names are matched per token

The first regex matched substrings, so `design_review` would have failed on `sign`. Names are
now split on `_`/`-` and compared token by token, with a short list of phrases matched
anywhere (`execute_payment`, `private_key`, …). `get_signature_status` passes and `sign_tx`
does not. The same function exists on both sides, and the fixtures cover both outcomes.

### The bundle travels inline, not as a path

The runbook proposed `--bundle <stored-path>` under `AGENT_RAILS_HOME/connectors/`. A hosted
dashboard and the operator's runner share no filesystem, so the exported `.mcp.json` carries
the bundle in `CONNECTOR_BUNDLE_JSON`. The bundle holds no secrets, so exporting it adds no
new exposure. Secret values stay on the MCP row's masked `env`, same as any other MCP.

### One write path for three sources

File import, the chat fence and the canvas proposal all call `POST /api/connectors/import`,
which validates again. The browser's parse is only for the preview; the server decides what
gets written. If someone pastes a key into a bundle's `env`, the route moves it onto the
masked row and blanks it in the bundle. The bundle is shown and exported unmasked, so it must
never be where a key lives.

### File imports land disabled; chat and canvas land enabled

An imported file is global, so enabling it would change every agent's toolset with no one
choosing to. It lands disabled, the same rule as an imported skill. For chat and canvas, the
operator picks the workflow or agent when clicking *Add*, and that choice is the approval.

### The column is optional, and only written when set

`mcpToRow` sends `connector` only when a row has one. An unmigrated Supabase deployment keeps
saving every existing row, and fails only on the first connector import. `mcpFromRow`
re-validates the column, so a bundle edited in the database cannot reach a runner if the
import route would have refused it.

### The chat panel parses only closed fences

During streaming, a half-written block stays as text and becomes a card once its closing
backticks arrive. The system prompt describes the bundle shape in prose, not as a fenced
example: a model that copies examples would otherwise echo a literal block, and the panel
would offer to install it. A test checks that the prompt contains no parseable proposal.

## What the scaffold got wrong

Found while implementing, all fixed:

1. **Every process env var was reachable from a bundle.** The host merged `os.environ` into
   the bundle's env, so a header of `{{ENV:AGENT_RAILS_SESSION_SIGNER}}` would have sent the
   payment server's signer to whatever host the bundle named. The host now reads only the
   names the bundle declares, and the schema refuses the `AGENT_RAILS_`, `SOLANA_` and
   `CONNECTOR_` prefixes. A test checks that a value seeded into the process env never shows up
   in a request or in `connector_catalog`.
2. **Placeholders only resolved when they were the whole value.** The regex was anchored, so
   the sample's own `Bearer {{ENV:WEATHER_API_KEY}}` was sent literally. Placeholders now
   resolve anywhere in a string. An unset secret is an error, never an empty header.
3. **Tools had no usable input schema.** A `**kwargs` handler gives FastMCP nothing to derive
   one from. The host now builds a real signature from the bundle's parameters (FastMCP then
   validates types), and advertises the bundle's own JSON schema so enums and descriptions
   reach the agent.
4. **No destination checks.** The scaffold had none. A generated bundle could have pointed at
   `localhost`, the dashboard, or `169.254.169.254`. The host now allows https only, follows
   no redirects, refuses non-public resolved addresses, and caps responses at 1 MB.

## How the work was split out

The work started as uncommitted changes on `feat/adr021-wave2a-bootstrap`, mixed with an
earlier session's uncommitted workstation/template changes, and some hunks in the same files
interleaved. It was moved to `feat/fastmcp-connectors` in a worktree. Feature-only files were
copied whole; the edits to the six mixed files (`contract/src/index.ts`, `tsdown.config.ts`,
`workflow-canvas.tsx`, `use-dashboard.ts`, both locale files) were re-applied rather than
hunk-split. The lockfile was regenerated there. On its own, the branch passes lint,
typecheck, contract (51), dashboard (285) and pytest (37). The workstation work stays
uncommitted on the wave-2A branch.

## What is left, and who unblocks it

| Item | State | Who |
|---|---|---|
| Apply migration `20260930010000` to Supabase | not applied | Owner (run `supabase db push` after a diff) |
| Accept or amend ADR-023 | Proposed | Owner |
| `uv tool install ./services/connector-host` on each runner | manual | Operator |
| Playwright spec: import a file, see the badge; chat card → MCP row | not written | Next session |
| Hot reload / session registry (P0-04 remainder) | re-export to change a connector | Next session |
| Jupiter as an OpenAPI bundle, parity with the TS MCP (P0-05) | not started | Next session |
| DNS rebinding between the address check and the connect | open; set `CONNECTOR_ALLOWED_HOST_SUFFIXES` on hosted runners | Design |
| Postman / GraphQL import | refused by name | Phase 2 |
