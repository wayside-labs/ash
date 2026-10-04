import type { MessageKey } from "@/i18n";

/**
 * The hint under a failed turn, keyed on the provider the user selected rather than on the
 * `x-agent-rails-mode` of an earlier reply. A request that dies before any headers — a 502
 * from the tunnel while the service restarts — never sets a mode, and a fallback of "check
 * your API key" would blame the one thing that was not wrong.
 */
export function chatErrorHintKey(failure: {
  creditShort: boolean;
  provider: string | null | undefined;
}): MessageKey {
  if (failure.creditShort) return "chat.error.addCredit";
  switch (failure.provider) {
    case "claude-cli":
      return "chat.error.checkSubscription";
    case "openrouter-platform":
      return "chat.error.checkPlatform";
    case "anthropic-api":
      return "chat.error.checkApiKey";
    default:
      return "chat.error.tryAgain";
  }
}

export type ChatProviderOption = {
  id: "claude-cli" | "anthropic-api" | "openrouter-platform" | "demo";
  label: string;
  detail: string;
  models: { id: string; label: string }[];
};

const CLI_DEFAULT = "claude-cli:sonnet";
const API_DEFAULT = "claude-sonnet-5";
const PLATFORM_DEFAULT = "openrouter:anthropic/claude-haiku-4.5";

function hasRealProvider(available: ChatProviderOption[]): boolean {
  return available.some((p) => p.id !== "demo");
}

/** Demo is last resort — hide it from the picker when anything real is available. */
export function selectableProviders(available: ChatProviderOption[]): ChatProviderOption[] {
  return hasRealProvider(available) ? available.filter((p) => p.id !== "demo") : available;
}

function preferredDefaultModel(providers: ChatProviderOption[]): string | undefined {
  const api = providers.find((p) => p.id === "anthropic-api");
  if (api) {
    return api.models.find((m) => m.id === API_DEFAULT)?.id ?? api.models[0]?.id;
  }
  const platform = providers.find((p) => p.id === "openrouter-platform");
  if (platform) {
    return platform.models.find((m) => m.id === PLATFORM_DEFAULT)?.id ?? platform.models[0]?.id;
  }
  if (providers.some((p) => p.id === "claude-cli")) return CLI_DEFAULT;
  return providers.find((p) => p.id === "demo")?.models[0]?.id;
}

/**
 * Keeps the persisted model when it is still valid; otherwise picks the same
 * default resolveProvider() would use (API sonnet, then the platform key, then
 * CLI sonnet, then demo).
 */
export function reconcileSelectedModel(
  selectedModel: string,
  available: ChatProviderOption[],
): string | undefined {
  const selectable = selectableProviders(available);
  if (selectable.length === 0) return undefined;

  if (selectedModel && selectable.some((p) => p.models.some((m) => m.id === selectedModel))) {
    return selectedModel;
  }

  return preferredDefaultModel(selectable);
}
