import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readState } from "@/lib/server/store";

const run = promisify(execFile);

export type ProviderId = "claude-cli" | "anthropic-api" | "demo";

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  available: boolean;
  /** Why it is unavailable, or how it is being paid for. */
  detail: string;
  models: { id: string; label: string }[];
};

/**
 * Probing spawns a process, so the answer is cached briefly. The CLI does not
 * appear or vanish mid-session in practice, and the chat page asks on mount.
 */
let cliProbe: { at: number; version: string | null } | null = null;
const PROBE_TTL_MS = 60_000;

async function probeClaudeCli(): Promise<string | null> {
  if (cliProbe && Date.now() - cliProbe.at < PROBE_TTL_MS) return cliProbe.version;
  let version: string | null = null;
  try {
    const { stdout } = await run("claude", ["--version"], { timeout: 10_000 });
    version = stdout.trim() || null;
  } catch {
    version = null;
  }
  cliProbe = { at: Date.now(), version };
  return version;
}

export async function anthropicApiKey(): Promise<string | undefined> {
  const state = await readState();
  const stored = state.apiKeys.find((k) => k.provider.toLowerCase() === "anthropic")?.secret;
  return stored || process.env.ANTHROPIC_API_KEY || undefined;
}

export async function listProviders(): Promise<ProviderStatus[]> {
  const [cliVersion, apiKey] = await Promise.all([probeClaudeCli(), anthropicApiKey()]);

  return [
    {
      id: "claude-cli",
      label: "Claude Code (sua assinatura)",
      available: cliVersion !== null,
      detail: cliVersion
        ? `CLI ${cliVersion} — usa sua assinatura Claude, sem custo por token`
        : "Claude Code não encontrado no PATH deste servidor",
      models: [
        { id: "claude-cli:opus", label: "Opus" },
        { id: "claude-cli:sonnet", label: "Sonnet" },
        { id: "claude-cli:haiku", label: "Haiku" },
      ],
    },
    {
      id: "anthropic-api",
      label: "Anthropic API",
      available: Boolean(apiKey),
      detail: apiKey
        ? "Chave configurada — cobrado por token"
        : "Nenhuma chave Anthropic em My APIs",
      models: [
        { id: "claude-opus-5", label: "Opus 5" },
        { id: "claude-sonnet-5", label: "Sonnet 5" },
        { id: "claude-haiku-4-5", label: "Haiku 4.5" },
      ],
    },
    {
      id: "demo",
      label: "Demonstração",
      available: true,
      detail: "Respostas fixas, sem modelo",
      models: [{ id: "demo", label: "Demo" }],
    },
  ];
}

/**
 * The local CLI wins by default: it costs the user nothing extra and needs no
 * key. An explicitly chosen model always overrides this.
 */
export async function resolveProvider(requestedModel: string | undefined): Promise<{
  provider: ProviderId;
  model: string;
}> {
  const providers = await listProviders();
  const byId = new Map(providers.map((p) => [p.id, p]));

  if (requestedModel) {
    const owner = providers.find(
      (p) => p.available && p.models.some((m) => m.id === requestedModel),
    );
    if (owner) return { provider: owner.id, model: requestedModel };
  }

  if (byId.get("claude-cli")?.available) {
    return { provider: "claude-cli", model: "claude-cli:sonnet" };
  }
  if (byId.get("anthropic-api")?.available) {
    return { provider: "anthropic-api", model: "claude-sonnet-5" };
  }
  return { provider: "demo", model: "demo" };
}
