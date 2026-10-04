import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { type Locale, t } from "@/i18n";
import { getSessionUser } from "@/lib/server/auth/session";
import { getDashboardLocale } from "@/lib/server/i18n";
import { readState, StateAccessError } from "@/lib/server/store";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { ANTHROPIC_API_MODELS } from "./anthropic-api";
import { OPENROUTER_DEFAULT_MODEL, OPENROUTER_MODELS } from "./openrouter-api";

const run = promisify(execFile);

export type ProviderId = "claude-cli" | "anthropic-api" | "openrouter-platform" | "demo";

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

export type PlatformAccess =
  | { granted: true; apiKey: string; user?: string }
  | { granted: false; reason: "unconfigured" | "signed-out" };

/**
 * The platform key spends the operator's money, so who may use it is decided
 * here and nowhere else. Hosted (Supabase configured): a signed-in session, or
 * nothing — the tenant snapshot also 401s without one, but that is
 * `buildContext`'s side effect and not a gate this key may rest on. Local JSON
 * mode has no sessions; setting the env var there is the operator opting in,
 * exactly as `ANTHROPIC_API_KEY` already is.
 */
export async function openrouterPlatformAccess(): Promise<PlatformAccess> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { granted: false, reason: "unconfigured" };
  if (!isSupabaseConfigured()) return { granted: true, apiKey };
  const session = await getSessionUser();
  if (!session) return { granted: false, reason: "signed-out" };
  // Hashed so the auth uuid never leaves for a third party; stable, so
  // OpenRouter's per-user abuse isolation still has something to key on.
  const user = createHash("sha256").update(session.id).digest("hex").slice(0, 32);
  return { granted: true, apiKey, user };
}

/**
 * `claude-cli` drives the host's own `claude` login, so on a hosted install every
 * visitor would spend the operator's subscription (ADR-017, ADR-019: it is a
 * development-only provider and stays off for hosted tenants). It is therefore not
 * listed, not probed and never resolved there — which also covers a browser that still
 * remembers a `claude-cli:*` model, since `resolveProvider` only honours listed ones.
 */
export async function listProviders(locale?: Locale): Promise<ProviderStatus[]> {
  const lang = locale ?? (await getDashboardLocale());
  const hosted = isSupabaseConfigured();
  const [cliVersion, apiKey, platform] = await Promise.all([
    hosted ? null : probeClaudeCli(),
    anthropicApiKey(),
    openrouterPlatformAccess(),
  ]);

  const all: ProviderStatus[] = [
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
      id: "openrouter-platform",
      label: t("providers.openrouterPlatform.label", lang),
      available: platform.granted,
      detail: platform.granted
        ? t("providers.openrouterPlatform.detailAvailable", lang)
        : platform.reason === "signed-out"
          ? t("providers.openrouterPlatform.detailSignedOut", lang)
          : t("providers.openrouterPlatform.detailUnconfigured", lang),
      models: OPENROUTER_MODELS.map((m) => ({ ...m })),
    },
    {
      id: "demo",
      label: t("providers.demo.label", lang),
      available: true,
      detail: t("providers.demo.detail", lang),
      models: [{ id: "demo", label: t("providers.model.demo", lang) }],
    },
  ];
  return hosted ? all.filter((p) => p.id !== "claude-cli") : all;
}

/**
 * A key the user brought wins: it is theirs to spend. The platform key comes
 * next, ahead of the local CLI — the probe only proves the binary runs, not that
 * its login still works, so a CLI with an expired session would otherwise
 * outrank a key that does. Demo is last. An explicitly chosen model always
 * overrides this.
 *
 * `platform: false` is for callers that cannot meter the platform key
 * (`complete.ts`); the chat route is the only one that charges for it.
 */
export async function resolveProvider(
  requestedModel: string | undefined,
  options: { platform?: boolean } = {},
): Promise<{
  provider: ProviderId;
  model: string;
}> {
  const providers = (await listProviders()).filter(
    (p) => options.platform !== false || p.id !== "openrouter-platform",
  );
  const byId = new Map(providers.map((p) => [p.id, p]));

  if (requestedModel) {
    const owner = providers.find(
      (p) => p.available && p.models.some((m) => m.id === requestedModel),
    );
    if (owner) return { provider: owner.id, model: requestedModel };
  }

  if (byId.get("anthropic-api")?.available) {
    return { provider: "anthropic-api", model: "claude-sonnet-5" };
  }
  if (byId.get("openrouter-platform")?.available) {
    return { provider: "openrouter-platform", model: OPENROUTER_DEFAULT_MODEL };
  }
  if (byId.get("claude-cli")?.available) {
    return { provider: "claude-cli", model: "claude-cli:sonnet" };
  }
  return { provider: "demo", model: "demo" };
}
