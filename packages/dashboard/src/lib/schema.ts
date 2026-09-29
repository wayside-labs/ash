import { z } from "zod";

export const solanaClusterSchema = z.enum(["devnet", "testnet", "mainnet-beta"]);
export const operationModeSchema = z.enum(["native", "agent-rails"]);
export const agentStatusSchema = z.enum(["active", "paused", "expired"]);
export const scopeSchema = z.enum(["global", "workflow", "agent"]);

export type SolanaCluster = z.infer<typeof solanaClusterSchema>;
export type OperationMode = z.infer<typeof operationModeSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type Scope = z.infer<typeof scopeSchema>;

/**
 * Base58 minus the ambiguous glyphs, 32..44 chars. Cheap pre-filter so a demo
 * placeholder never reaches the RPC as a getBalance argument.
 */
const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export const addressSchema = z.string().regex(BASE58_ADDRESS, "invalid Solana address");

export function isLikelyAddress(value: string | null | undefined): value is string {
  return typeof value === "string" && BASE58_ADDRESS.test(value) && value.length >= 43;
}

/**
 * Canvas layout only: node positions and nodes the operator hid. The graph itself is derived
 * from agents, `paysTo` and MCP scope (`lib/canvas-graph.ts`), never stored.
 */
export const workflowLayoutSchema = z.object({
  positions: z
    .record(z.string().max(80), z.object({ x: z.number().finite(), y: z.number().finite() }))
    .default({}),
  hidden: z.array(z.string().max(80)).max(500).default([]),
});
export type WorkflowLayout = z.infer<typeof workflowLayoutSchema>;

export const workflowSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  icon: z.string().default("⚡"),
  /** Treasury PDA once the workflow has been bootstrapped on-chain. */
  treasuryAddress: z.string().nullable().default(null),
  ownerAddress: z.string().nullable().default(null),
  cluster: solanaClusterSchema.default("devnet"),
  demo: z.boolean().default(false),
  /** Only rendered for demo rows; real rows read their balance from the RPC. */
  demoBalanceUsd: z.number().nullable().default(null),
  layout: workflowLayoutSchema.default({ positions: {}, hidden: [] }),
  createdAt: z.string(),
});

export const agentSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.string().default(""),
  workflowId: z.string(),
  walletAddress: z.string().nullable().default(null),
  sessionAddress: z.string().nullable().default(null),
  dailyLimitUsd: z.number().nonnegative().default(0),
  paysTo: z.array(z.string()).default([]),
  receivesFrom: z.string().default(""),
  status: agentStatusSchema.default("active"),
  demo: z.boolean().default(false),
  demoBalanceUsd: z.number().nullable().default(null),
  demoSpentUsd: z.number().nullable().default(null),
  createdAt: z.string(),
});

/**
 * POSIX-ish environment variable name. The runner passes these straight to a
 * spawned process, so a key with a `=` or a space in it would produce an
 * environment block no shell can represent.
 */
const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const envKeySchema = z.string().regex(ENV_KEY, "invalid environment variable name");

export const mcpServerSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  enabled: z.boolean().default(false),
  scope: scopeSchema.default("global"),
  scopeName: z.string().nullable().default(null),
  /** Executable the runner spawns, e.g. `npx` or `node`. Empty = not runnable yet. */
  command: z.string().default(""),
  args: z.array(z.string()).default([]),
  /**
   * Connection strings and API keys. Same secret class as `apiKeySchema.secret`:
   * masked by `maskState` on every read and only ever emitted whole by the
   * runner-config export route.
   */
  env: z.record(envKeySchema, z.string()).default({}),
  demo: z.boolean().default(false),
});

/**
 * A knowledge-base document. The text itself is chunked into a separate store
 * (`lib/server/knowledge`); this row is what the list shows and what scope filters on.
 * `mode` says how it is searchable: `vector` with Voyage embeddings, `lexical` (BM25)
 * without — never a pretence of one as the other.
 */
export const ragDocumentSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: z.enum(["pdf", "md", "url"]),
  status: z.enum(["indexed", "indexing", "error"]).default("indexing"),
  scope: scopeSchema.default("global"),
  scopeName: z.string().default("All"),
  /** The URL for `url` documents; null for uploads. */
  source: z.string().nullable().default(null),
  demo: z.boolean().default(false),
  error: z.string().nullable().default(null),
  chunkCount: z.number().int().nonnegative().default(0),
  mode: z.enum(["vector", "lexical"]).nullable().default(null),
  bytes: z.number().int().nonnegative().default(0),
  indexedAt: z.string().nullable().default(null),
});

export const skillSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  icon: z.string().default("🧩"),
  /**
   * The skill itself: the Markdown body of a `SKILL.md`, exported into the runner
   * bundle (`.claude/skills/<slug>/`) of every agent in scope. The description is the
   * one-liner that decides *whether* the agent loads it; this is what it then reads.
   */
  content: z.string().default(""),
  scope: scopeSchema.default("global"),
  scopeName: z.string().nullable().default(null),
  enabled: z.boolean().default(false),
  demo: z.boolean().default(false),
});

export const apiKeySchema = z.object({
  id: z.string(),
  provider: z.string().min(1),
  /** Never leaves the server — the API layer masks this on every read. */
  secret: z.string().default(""),
  createdAt: z.string(),
});

export const channelKindSchema = z.enum(["webhook", "slack", "telegram", "email"]);
export type ChannelKind = z.infer<typeof channelKindSchema>;

export const CHANNEL_EVENT_KINDS = [
  "payment_denied",
  "headroom_low",
  "payment_review_required",
  "limit_increase_requested",
] as const;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** `<bot token>#<chat id>`: a bot token already contains a colon. */
const TELEGRAM = /^\d+:[\w-]{20,}#-?\d+$/;

function validTarget(kind: ChannelKind, target: string): boolean {
  if (target === "") return true;
  switch (kind) {
    case "webhook":
      return URL.canParse(target) && new URL(target).protocol === "https:";
    case "slack":
      return URL.canParse(target) && new URL(target).host === "hooks.slack.com";
    case "telegram":
      return TELEGRAM.test(target);
    case "email":
      return EMAIL.test(target);
  }
}

/**
 * A notification channel. Agent events reach the dashboard through the ingest API and are
 * fanned out to every enabled channel subscribed to their kind (`lib/server/notify`).
 *
 * `target` is where to deliver: a webhook URL, a Slack incoming-webhook URL,
 * `<bot token>#<chat id>` for Telegram, or an email address. The first three carry a
 * credential in the string itself, so `target` is the same secret class as an MCP env
 * value — masked on every read.
 */
export const integrationSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string().default(""),
    icon: z.string().default("🔌"),
    /** Legacy display field from before channels; unused. */
    url: z.string().default(""),
    connected: z.boolean().default(false),
    kind: channelKindSchema.default("webhook"),
    target: z.string().default(""),
    events: z.array(z.enum(CHANNEL_EVENT_KINDS)).default([...CHANNEL_EVENT_KINDS]),
    enabled: z.boolean().default(true),
    lastDeliveryAt: z.string().nullable().default(null),
    lastError: z.string().nullable().default(null),
  })
  .refine((row) => validTarget(row.kind, row.target), {
    message: "target does not match the channel kind",
    path: ["target"],
  });

export const profileSchema = z.object({
  displayName: z.string().default(""),
  company: z.string().default(""),
  bio: z.string().default(""),
  email: z.string().default(""),
});

const alertWebhookUrlSchema = z
  .string()
  .default("")
  .refine((value) => value === "" || z.url().safeParse(value).success, {
    message: "invalid webhook URL",
  });

export const settingsSchema = z.object({
  language: z.enum(["pt-BR", "en"]).default("en"),
  emailNotifications: z.boolean().default(false),
  limitAlerts: z.boolean().default(true),
  /**
   * Superseded by channels (`integrations`); kept so an older dashboard.json still parses.
   * The JSON store moves a non-empty value into a webhook channel on first read.
   */
  alertWebhookUrl: alertWebhookUrlSchema,
});

export const dashboardStateSchema = z.object({
  version: z.literal(1).default(1),
  workflows: z.array(workflowSchema).default([]),
  agents: z.array(agentSchema).default([]),
  mcps: z.array(mcpServerSchema).default([]),
  rag: z.array(ragDocumentSchema).default([]),
  skills: z.array(skillSchema).default([]),
  apiKeys: z.array(apiKeySchema).default([]),
  integrations: z.array(integrationSchema).default([]),
  profile: profileSchema.default({ displayName: "", company: "", bio: "", email: "" }),
  settings: settingsSchema.default({
    language: "en",
    emailNotifications: false,
    limitAlerts: true,
    alertWebhookUrl: "",
  }),
});

export type DashboardState = z.infer<typeof dashboardStateSchema>;
export type StoredWorkflow = z.infer<typeof workflowSchema>;
export type StoredAgent = z.infer<typeof agentSchema>;
export type StoredMcp = z.infer<typeof mcpServerSchema>;
export type StoredRagDocument = z.infer<typeof ragDocumentSchema>;
export type StoredSkill = z.infer<typeof skillSchema>;
export type StoredApiKey = z.infer<typeof apiKeySchema>;
export type StoredIntegration = z.infer<typeof integrationSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Settings = z.infer<typeof settingsSchema>;

/** Collections the generic resource route is allowed to mutate. */
export const RESOURCE_SCHEMAS = {
  workflows: workflowSchema,
  agents: agentSchema,
  mcps: mcpServerSchema,
  rag: ragDocumentSchema,
  skills: skillSchema,
  apiKeys: apiKeySchema,
  integrations: integrationSchema,
} as const;

export type ResourceName = keyof typeof RESOURCE_SCHEMAS;

export function isResourceName(value: string): value is ResourceName {
  return Object.hasOwn(RESOURCE_SCHEMAS, value);
}
