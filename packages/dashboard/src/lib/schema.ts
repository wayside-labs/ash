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

export const ragDocumentSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  type: z.enum(["pdf", "md", "url"]),
  status: z.enum(["indexed", "indexing", "error"]).default("indexing"),
  scope: scopeSchema.default("global"),
  scopeName: z.string().default("All"),
  source: z.string().nullable().default(null),
  demo: z.boolean().default(false),
});

export const skillSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  description: z.string().default(""),
  icon: z.string().default("🧩"),
  /**
   * The skill itself: Markdown injected into the agent's system prompt. The
   * description is the one-liner that decides *whether* to load it; this is
   * what the agent actually reads.
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

export const integrationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  icon: z.string().default("🔌"),
  url: z.string().default(""),
  connected: z.boolean().default(false),
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
  /** Generic HTTPS webhook for payment_denied and headroom_low alerts (Slack incoming URLs work). */
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
