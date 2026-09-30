export type ChatProviderOption = {
  id: "claude-cli" | "anthropic-api" | "openai-api" | "demo";
  label: string;
  detail: string;
  models: { id: string; label: string }[];
};

const CLI_DEFAULT = "claude-cli:sonnet";

/** Mirrors PREFERRED_DEFAULTS in lib/server/llm/providers.ts, which is server-only. */
const API_DEFAULTS: Record<"anthropic-api" | "openai-api", string[]> = {
  "anthropic-api": ["claude-sonnet-5"],
  "openai-api": ["openai:gpt-5", "openai:gpt-4.1", "openai:gpt-4o"],
};

function hasRealProvider(available: ChatProviderOption[]): boolean {
  return available.some((p) => p.id !== "demo");
}

/** Demo is last resort — hide it from the picker when anything real is available. */
export function selectableProviders(available: ChatProviderOption[]): ChatProviderOption[] {
  return hasRealProvider(available) ? available.filter((p) => p.id !== "demo") : available;
}

function preferredDefaultModel(providers: ChatProviderOption[]): string | undefined {
  if (providers.some((p) => p.id === "claude-cli")) return CLI_DEFAULT;
  for (const id of ["anthropic-api", "openai-api"] as const) {
    const api = providers.find((p) => p.id === id);
    if (!api) continue;
    const preferred = API_DEFAULTS[id].find((m) => api.models.some((option) => option.id === m));
    const model = preferred ?? api.models[0]?.id;
    if (model) return model;
  }
  return providers.find((p) => p.id === "demo")?.models[0]?.id;
}

/**
 * Keeps the persisted model when it is still valid; otherwise picks the same
 * default resolveProvider() would use (CLI, then the Anthropic key, then the OpenAI key,
 * then demo).
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
