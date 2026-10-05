#!/usr/bin/env bash
# Run one agent task headless with Claude Code, wired to the rails MCP, the three vendor MCPs
# and the repo's skills — and nothing else.
#
#   examples/agent-infra/run-agent.sh <task> [agents.env]
#   examples/agent-infra/run-agent.sh <task> --bundle <dir>
#   task: a file in tasks/ (without .md), or a path to any prompt file.
#   --bundle: an unzipped runner bundle from the dashboard (agent settings → MCP → Download
#   bundle). Its .mcp.json and .claude/skills replace the ones this script would build.
#
# Isolation, for the same reasons the dashboard's chat sandbox gives
# (packages/dashboard/src/lib/server/llm/claude-cli.ts):
#   --strict-mcp-config        only the servers written below, never the user's own
#   --setting-sources project  only this run's .claude/, never ~/.claude skills or hooks
#   an allowlist of tools      MCP + Skill; no shell, no file writes, no web
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
task="${1:?usage: run-agent.sh <task> [agents.env | --bundle <dir>]}"
bundle=""
envfile="$here/agents.env"
if [[ ${2:-} == --bundle ]]; then
  bundle="$(cd "${3:?--bundle needs a directory}" && pwd)"
  [[ -f $bundle/.mcp.json ]] || { echo "$bundle has no .mcp.json" >&2; exit 2; }
elif [[ -n ${2:-} ]]; then
  envfile="$2"
fi

prompt_file="$here/tasks/$task.md"
[[ -f $prompt_file ]] || prompt_file="$task"
[[ -f $prompt_file ]] || { echo "no task $task" >&2; exit 2; }

# Env files written before the ASH rename say AGENT_RAILS_*; prefer ASH_*, fall back to the old name.
legacy_env() {
  local legacy new
  for legacy in $(compgen -v AGENT_RAILS_); do
    new="ASH_${legacy#AGENT_RAILS_}"
    [[ -n ${!new:-} ]] || export "$new=${!legacy}"
  done
}

# A fresh workdir per run: the transcript and the skills it saw are kept together.
runs="${ASH_HOME:-$HOME/.ash}/agent-runs"
work="$runs/$(date -u +%Y%m%dT%H%M%SZ)-$(basename "$prompt_file" .md)"
mkdir -p "$work/.claude/skills"

if [[ -n $bundle ]]; then
  # The dashboard compiled servers and skills for exactly this agent; use them as they are.
  install -m 600 "$bundle/.mcp.json" "$work/mcp.json"
  if [[ -d $bundle/.claude/skills ]]; then cp -R "$bundle/.claude/skills/." "$work/.claude/skills/"; fi
  AGENT_MODEL="${AGENT_MODEL:-sonnet}"
  AGENT_MAX_TURNS="${AGENT_MAX_TURNS:-25}"
else
  [[ -f $envfile ]] || { echo "missing $envfile (copy agents.env.example)" >&2; exit 2; }
  set -a; . "$envfile"; set +a
  legacy_env
  : "${ASH_SESSION:?set ASH_SESSION in $envfile}"
  : "${ASH_SIGNER:?set ASH_SIGNER in $envfile}"
  ASH_SIGNER="${ASH_SIGNER/#\~/$HOME}"

  mcp_entry="$repo/packages/mcp/dist/cli.js"
  vendor_entry="$repo/packages/vendors/dist/cli.js"
  for f in "$mcp_entry" "$vendor_entry"; do
    [[ -f $f ]] || { echo "not built: $f — run pnpm build" >&2; exit 2; }
  done
  for skill in "$repo"/examples/skills/*/; do
    ln -s "$skill" "$work/.claude/skills/$(basename "$skill")"
  done
MCP_ENTRY="$mcp_entry" VENDOR_ENTRY="$vendor_entry" KNOWLEDGE_ENTRY="$repo/packages/knowledge-mcp/dist/cli.js" node - "$work/mcp.json" <<'JS'
const [out] = process.argv.slice(2);
const e = process.env;
const vendor = (id, url) => ({
  command: "node",
  args: [e.VENDOR_ENTRY, "mcp", id],
  env: { [`${id.toUpperCase()}_URL`]: url, ASH_SESSION: e.ASH_SESSION },
});
const rails = {
  ASH_RPC: e.ASH_RPC,
  ASH_SESSION: e.ASH_SESSION,
  ASH_SIGNER: e.ASH_SIGNER,
  ASH_TOOLS: e.ASH_TOOLS ?? "full",
  ...(e.ASH_FEE_PAYER ? { ASH_FEE_PAYER: e.ASH_FEE_PAYER } : {}),
};
const ingest =
  e.ASH_INGEST_URL && e.ASH_INGEST_TOKEN
    ? { ASH_INGEST_URL: e.ASH_INGEST_URL, ASH_INGEST_TOKEN: e.ASH_INGEST_TOKEN }
    : null;
if (ingest) Object.assign(rails, ingest);
const config = {
  mcpServers: {
    "ash": { command: "node", args: [e.MCP_ENTRY], env: rails },
    "vendor-oracle": vendor("oracle", e.ORACLE_URL),
    "vendor-notary": vendor("notary", e.NOTARY_URL),
    "vendor-compute": vendor("compute", e.COMPUTE_URL),
    ...(ingest
      ? {
          knowledge: {
            command: "node",
            args: [e.KNOWLEDGE_ENTRY],
            env: { ...ingest, ...(e.AGENT_NAME ? { ASH_AGENT_NAME: e.AGENT_NAME } : {}) },
          },
        }
      : {}),
  },
};
require("node:fs").writeFileSync(out, JSON.stringify(config, null, 2), { mode: 0o600 });
JS

fi

cp "$prompt_file" "$work/task.md"
echo "run dir: $work" >&2

# Every server in the config, and only those: the names come from the file, not from a list
# that could drift from it.
mapfile -t allowed < <(node -e '
  const c = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  for (const k of Object.keys(c.mcpServers ?? {})) console.log(`mcp__${k}`);
' "$work/mcp.json")

cd "$work"
claude -p "$(cat task.md)" \
  --model "${AGENT_MODEL:-sonnet}" \
  --max-turns "${AGENT_MAX_TURNS:-25}" \
  --mcp-config "$work/mcp.json" \
  --strict-mcp-config \
  --setting-sources project \
  --allowedTools "${allowed[@]}" "Skill" \
  --disallowedTools "Bash" "Edit" "Write" "NotebookEdit" "WebFetch" "WebSearch" "Task" \
  --output-format stream-json --verbose \
  | tee "$work/transcript.jsonl" \
  | node -e '
      let buf = "";
      process.stdin.on("data", (c) => {
        buf += c;
        const lines = buf.split("\n"); buf = lines.pop();
        for (const l of lines) {
          try {
            const ev = JSON.parse(l);
            for (const b of ev.message?.content ?? []) {
              if (b.type === "tool_use") console.error(`→ ${b.name} ${JSON.stringify(b.input)}`);
              if (b.type === "text" && ev.type === "assistant") console.log(b.text);
            }
            if (ev.type === "result") console.error(`— ${ev.subtype}, ${ev.num_turns} turns, $${ev.total_cost_usd ?? "?"}`);
          } catch {}
        }
      });'
