# ash-connector (Python)

Stdio **FastMCP** host (`mcp` 1.x — pin `<2` until we migrate to `MCPServer` in MCP SDK v2)
that mounts **declarative** HTTP tools from a connector bundle. It does not sign
transactions, hold session keys, or expose ASH governance — see ADR-023.

## Install

```bash
cd services/connector-host
uv sync --extra dev             # development
uv tool install .               # runners: puts `ash-connector` on PATH
```

## Run (stdio MCP)

```bash
# Any accepted format: bundle .yaml/.json, OpenAPI 3 .yaml/.json, .md with frontmatter
ash-connector --bundle ../../examples/connectors/sample-weather.yaml

# Validate and print the normalized bundle (and skipped OpenAPI operations)
ash-connector --bundle petstore.openapi.yaml --check

# What the dashboard's runner export does: bundle inline, no file path
CONNECTOR_BUNDLE_JSON='{"name":"x","tools":[...]}' ash-connector
```

The dashboard writes this for you (MCPs → *Import connector*, or *Add connector* on a chat
proposal); the exported `.mcp.json` entry looks like:

```json
{
  "mcpServers": {
    "sample-weather": {
      "command": "ash-connector",
      "args": [],
      "env": {
        "WEATHER_API_KEY": "<from the MCP card>",
        "CONNECTOR_BUNDLE_JSON": "{\"apiVersion\":\"ash.connector/v1\",...}"
      }
    }
  }
}
```

## Security

- The bundle schema refuses governance/key tool names, reserved env prefixes
  (`ASH_`, `SOLANA_`, `CONNECTOR_`) and unknown fields. The Zod mirror in
  `@ash/contract` applies the same rules; `examples/connectors/fixtures/` holds both
  to them.
- Tools see only the env names their bundle declares, never the rest of the process env.
- https only; redirects are not followed; hosts that resolve to non-public addresses are
  refused; responses are capped at 1 MB.

| Env | Default | Meaning |
|-----|---------|---------|
| `CONNECTOR_HTTP_TIMEOUT_MS` | `15000` | per-request timeout |
| `CONNECTOR_ALLOWED_HOST_SUFFIXES` | unset (any public host) | comma-separated host allowlist |
| `CONNECTOR_ALLOW_HTTP` | unset | `1` permits plain http (local testing) |
| `CONNECTOR_ALLOW_PRIVATE_HOSTS` | unset | `1` skips the private-address check (local testing) |

## Tests

```bash
uv run --extra dev pytest              # or: scripts/verify.sh py
uv run python scripts/regen_import_fixtures.py   # after a deliberate import-rule change
```

Architecture and the implementation prompts: `docs/runbooks/fastmcp-connector-layer.md`.
