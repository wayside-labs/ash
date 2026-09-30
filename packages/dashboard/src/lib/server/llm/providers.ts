import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type Locale, t } from "@/i18n";
import { getDashboardLocale } from "@/lib/server/i18n";
import { readState, StateAccessError } from "@/lib/server/store";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { type Catalog, listAnthropicModels, listOpenAiModels } from "./model-catalog";

const run = promisify(execFile);

export type ProviderId = "claude-cli" | "anthropic-api" | "openai-api" | "demo";
export type ApiProviderId = "anthropic-api" | "openai-api";

export type ProviderStatus = {
  id: ProviderId;
  label: string;
  available: boolean;
  /** Why it is unavailable, or how it is being paid for. */
  detail: string;
  models: { id: string; label: string }[];
};

/** How each API provider is named in My APIs, and the operator env var local mode falls back to. */
const API_KEY_SOURCES: Record<ApiProviderId, { name: string; env: string }> = {
  "anthropic-api": { name: "anthropic", env: "ANTHROPIC_API_KEY" },
  "openai-api": { name: "openai", env: "OPENAI_API_KEY" },
};

/** Default model per provider when nothing was chosen, first one the catalog offers. */
const PREFERRED_DEFAULTS: Record<ApiProviderId, string[]> = {
  "anthropic-api": ["claude-sonnet-5"],
  "openai-api": ["openai:gpt-5", "openai:gpt-4.1", "openai:gpt-4o"],
};

/**
 * Hosted mode serves many tenants from one server. Anything that belongs to the machine —
 * the operator's logged-in Claude Code, an API key in the service's environment — would
 * answer every tenant's chat on the operator's account, so there only the tenant's own
 * keys count.
 */
function hosted(): boolean {
  return isSupabaseConfigured();
}

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

/** The caller's key for this provider: the newest non-empty one saved in My APIs. */
export async function providerApiKey(provider: ApiProviderId): Promise<string | undefined> {
  const { name, env } = API_KEY_SOURCES[provider];
  const fallback = hosted() ? undefined : process.env[env]?.trim() || undefined;
  try {
    const state = await readState();
    const stored = state.apiKeys
      .filter((k) => k.provider.trim().toLowerCase() === name && k.secret.trim())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
      ?.secret.trim();
    return stored || fallback;
  } catch (error) {
    if (error instanceof StateAccessError) return fallback;
    throw error;
  }
}

async function apiProviderStatus(
  id: ApiProviderId,
  lang: Locale,
  list: (key: string) => Promise<Catalog>,
  labelKey: string,
): Promise<ProviderStatus> {
  const label = t(`providers.${labelKey}.label`, lang);
  const key = await providerApiKey(id);
  if (!key) {
    return {
      id,
      label,
      available: false,
      detail: t(`providers.${labelKey}.detailUnavailable`, lang),
      models: [],
    };
  }
  const catalog = await list(key);
  if (catalog.kind === "rejected") {
    return {
      id,
      label,
      available: false,
      detail: t(`providers.${labelKey}.detailRejected`, lang),
      models: [],
    };
  }
  return {
    id,
    label,
    available: true,
    detail:
      catalog.kind === "ok"
        ? t(`providers.${labelKey}.detailAvailable`, lang, { count: catalog.models.length })
        : t("providers.api.detailUnlisted", lang),
    models: catalog.models,
  };
}

async function cliStatus(lang: Locale): Promise<ProviderStatus> {
  const base = {
    id: "claude-cli" as const,
    label: t("providers.claudeCli.label", lang),
    models: [
      { id: "claude-cli:opus", label: t("providers.model.opus", lang) },
      { id: "claude-cli:sonnet", label: t("providers.model.sonnet", lang) },
      { id: "claude-cli:haiku", label: t("providers.model.haiku", lang) },
    ],
  };
  if (hosted()) {
    return { ...base, available: false, detail: t("providers.claudeCli.detailHosted", lang) };
  }
  const version = await probeClaudeCli();
  return {
    ...base,
    available: version !== null,
    detail: version
      ? t("providers.claudeCli.detailAvailable", lang, { version })
      : t("providers.claudeCli.detailUnavailable", lang),
  };
}

export async function listProviders(locale?: Locale): Promise<ProviderStatus[]> {
  const lang = locale ?? (await getDashboardLocale());
  const [cli, anthropic, openai] = await Promise.all([
    cliStatus(lang),
    apiProviderStatus("anthropic-api", lang, listAnthropicModels, "anthropicApi"),
    apiProviderStatus("openai-api", lang, listOpenAiModels, "openaiApi"),
  ]);

  return [
    cli,
    anthropic,
    openai,
    {
      id: "demo",
      label: t("providers.demo.label", lang),
      available: true,
      detail: t("providers.demo.detail", lang),
      models: [{ id: "demo", label: t("providers.model.demo", lang) }],
    },
  ];
}

function defaultModel(provider: ProviderStatus): string | undefined {
  const preferred = PREFERRED_DEFAULTS[provider.id as ApiProviderId] ?? [];
  return preferred.find((id) => provider.models.some((m) => m.id === id)) ?? provider.models[0]?.id;
}

/**
 * An explicitly chosen model always wins. Otherwise the local CLI goes first — it costs the
 * user nothing extra and needs no key — then the user's own keys. Hosted mode never offers
 * the CLI, so there the user's key is the default.
 */
export async function resolveProvider(requestedModel: string | undefined): Promise<{
  provider: ProviderId;
  model: string;
}> {
  const providers = await listProviders();

  if (requestedModel) {
    const owner = providers.find(
      (p) => p.available && p.models.some((m) => m.id === requestedModel),
    );
    if (owner) return { provider: owner.id, model: requestedModel };
  }

  for (const id of ["claude-cli", "anthropic-api", "openai-api"] as const) {
    const provider = providers.find((p) => p.id === id && p.available);
    const model = provider && (id === "claude-cli" ? "claude-cli:sonnet" : defaultModel(provider));
    if (model) return { provider: id, model };
  }
  return { provider: "demo", model: "demo" };
}
