export type ChatProviderOption = {
  id: "claude-cli" | "anthropic-api" | "demo";
  label: string;
  detail: string;
  models: { id: string; label: string }[];
};

const CLI_DEFAULT = "claude-cli:sonnet";
const API_DEFAULT = "claude-sonnet-5";

function hasRealProvider(available: ChatProviderOption[]): boolean {
  return available.some((p) => p.id !== "demo");
}

/** Demo is last resort — hide it from the picker when anything real is available. */
export function selectableProviders(available: ChatProviderOption[]): ChatProviderOption[] {
  return hasRealProvider(available) ? available.filter((p) => p.id !== "demo") : available;
}

function preferredDefaultModel(providers: ChatProviderOption[]): string | undefined {
  if (providers.some((p) => p.id === "claude-cli")) return CLI_DEFAULT;
  const api = providers.find((p) => p.id === "anthropic-api");
  if (api) {
    return api.models.find((m) => m.id === API_DEFAULT)?.id ?? api.models[0]?.id;
  }
  return providers.find((p) => p.id === "demo")?.models[0]?.id;
}

/**
 * Keeps the persisted model when it is still valid; otherwise picks the same
 * default resolveProvider() would use (CLI sonnet, then API sonnet, then demo).
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
