import { createHash } from "node:crypto";
import { OPENAI_BASE_URL, OPENAI_MODEL_PREFIX } from "./openai-api";

export type ModelOption = { id: string; label: string };

/**
 * What a key can actually run, asked of the vendor rather than hard-coded: a tenant's key
 * may be scoped to some models, and a list baked into the build goes stale with every
 * release. `rejected` is the vendor refusing the key itself, which the picker must show
 * as such instead of offering models that will all fail.
 */
export type Catalog =
  | { kind: "ok"; models: ModelOption[] }
  | { kind: "rejected" }
  | { kind: "unreachable"; models: ModelOption[] };

const TTL_MS = 10 * 60_000;
const FAILURE_TTL_MS = 60_000;
const FETCH_MS = 5_000;

/** Keyed by a digest, never the key: this map outlives the request that brought the key. */
const cache = new Map<string, { at: number; ttl: number; value: Catalog }>();

async function cached(vendor: string, key: string, load: () => Promise<Catalog>): Promise<Catalog> {
  const id = `${vendor}:${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  const value = await load();
  cache.set(id, { at: Date.now(), ttl: value.kind === "ok" ? TTL_MS : FAILURE_TTL_MS, value });
  return value;
}

async function fetchModels(url: string, headers: Record<string, string>) {
  return fetch(url, { headers, signal: AbortSignal.timeout(FETCH_MS), cache: "no-store" });
}

// ── Anthropic ────────────────────────────────────────────────────────────────

/** Offered when the vendor cannot be asked; the ids match what the chat has always used. */
export const ANTHROPIC_FALLBACK_MODELS: ModelOption[] = [
  { id: "claude-opus-5", label: "Opus 5" },
  { id: "claude-sonnet-5", label: "Sonnet 5" },
  { id: "claude-haiku-4-5", label: "Haiku 4.5" },
];

export function listAnthropicModels(apiKey: string): Promise<Catalog> {
  return cached("anthropic", apiKey, async () => {
    try {
      const res = await fetchModels("https://api.anthropic.com/v1/models?limit=100", {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      });
      if (res.status === 401 || res.status === 403) return { kind: "rejected" };
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = (await res.json()) as { data?: { id: string; display_name?: string }[] };
      const models = (body.data ?? []).map((m) => ({ id: m.id, label: m.display_name || m.id }));
      if (models.length === 0) throw new Error("empty model list");
      return { kind: "ok", models };
    } catch (error) {
      console.warn("[llm] anthropic model list unavailable:", error);
      return { kind: "unreachable", models: ANTHROPIC_FALLBACK_MODELS };
    }
  });
}

// ── OpenAI ───────────────────────────────────────────────────────────────────

/**
 * `/v1/models` lists everything the key can touch: embeddings, speech, images, and
 * Responses-only models Chat Completions refuses. Only what the chat can stream stays.
 */
export function isOpenAiChatModel(id: string): boolean {
  if (!/^(gpt-|chatgpt-|o\d)/.test(id)) return false;
  if (
    /(embedding|tts|whisper|dall-e|image|audio|realtime|transcribe|search|moderation|instruct|codex|computer-use|deep-research)/.test(
      id,
    )
  ) {
    return false;
  }
  // Dated snapshots duplicate their alias and would triple the list.
  return !/-\d{4}-\d{2}-\d{2}$/.test(id);
}

export const OPENAI_FALLBACK_MODELS: ModelOption[] = ["gpt-5", "gpt-5-mini", "gpt-4.1"].map(
  (id) => ({ id: `${OPENAI_MODEL_PREFIX}${id}`, label: id }),
);

export function listOpenAiModels(apiKey: string): Promise<Catalog> {
  return cached("openai", apiKey, async () => {
    try {
      const res = await fetchModels(`${OPENAI_BASE_URL}/models`, {
        Authorization: `Bearer ${apiKey}`,
      });
      if (res.status === 401 || res.status === 403) return { kind: "rejected" };
      if (!res.ok) throw new Error(`http ${res.status}`);
      const body = (await res.json()) as { data?: { id: string; created?: number }[] };
      const models = (body.data ?? [])
        .filter((m) => isOpenAiChatModel(m.id))
        .sort((a, b) => (b.created ?? 0) - (a.created ?? 0) || a.id.localeCompare(b.id))
        .map((m) => ({ id: `${OPENAI_MODEL_PREFIX}${m.id}`, label: m.id }));
      if (models.length === 0) throw new Error("no chat models for this key");
      return { kind: "ok", models };
    } catch (error) {
      console.warn("[llm] openai model list unavailable:", error);
      return { kind: "unreachable", models: OPENAI_FALLBACK_MODELS };
    }
  });
}

/** Test seam: the cache is process-wide. */
export function clearModelCatalogCache(): void {
  cache.clear();
}
