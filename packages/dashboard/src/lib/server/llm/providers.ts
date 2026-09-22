import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Locale, t } from "@/i18n";
import { getDashboardLocale } from "@/lib/server/i18n";
import { readState, StateAccessError } from "@/lib/server/store";
import { ANTHROPIC_API_MODELS } from "./anthropic-api";

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
  try {
    const state = await readState();
    const stored = state.apiKeys.find((k) => k.provider.toLowerCase() === "anthropic")?.secret;
    return stored || process.env.ANTHROPIC_API_KEY || undefined;
  } catch (error) {
    if (error instanceof StateAccessError) {
      return process.env.ANTHROPIC_API_KEY || undefined;
    }
    throw error;
  }
}

export async function listProviders(locale?: Locale): Promise<ProviderStatus[]> {
  const lang = locale ?? (await getDashboardLocale());
  const [cliVersion, apiKey] = await Promise.all([probeClaudeCli(), anthropicApiKey()]);

  return [
    {
      id: "claude-cli",
      label: t("providers.claudeCli.label", lang),
      available: cliVersion !== null,
      detail: cliVersion
        ? t("providers.claudeCli.detailAvailable", lang, { version: cliVersion })
        : t("providers.claudeCli.detailUnavailable", lang),
      models: [
        { id: "claude-cli:opus", label: t("providers.model.opus", lang) },
        { id: "claude-cli:sonnet", label: t("providers.model.sonnet", lang) },
        { id: "claude-cli:haiku", label: t("providers.model.haiku", lang) },
      ],
    },
    {
      id: "anthropic-api",
      label: t("providers.anthropicApi.label", lang),
      available: Boolean(apiKey),
      detail: apiKey
        ? t("providers.anthropicApi.detailAvailable", lang)
        : t("providers.anthropicApi.detailUnavailable", lang),
      models: ANTHROPIC_API_MODELS.map((m) => ({ ...m })),
    },
    {
      id: "demo",
      label: t("providers.demo.label", lang),
      available: true,
      detail: t("providers.demo.detail", lang),
      models: [{ id: "demo", label: t("providers.model.demo", lang) }],
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
