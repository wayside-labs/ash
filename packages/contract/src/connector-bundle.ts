import { z } from "zod";

/**
 * Connector bundle v1: the declarative description of an unprivileged HTTP MCP that
 * `services/connector-host` (Python, FastMCP) mounts. Chat emits it, the dashboard imports
 * it, the runner export hands it to the host. It never carries code, keys, or a payment path.
 *
 * Mirrors `services/connector-host/src/agent_rails_connector/declarative.py`. The fixtures
 * under `examples/connectors/fixtures/` are loaded by both test suites; a rule added on one
 * side only fails the other's fixture test.
 */

export const CONNECTOR_API_VERSION = "agent-rails.connector/v1";
export const CONNECTOR_MAX_TOOLS = 32;
/** The fenced-block language the chat model uses to propose a bundle. */
export const CONNECTOR_FENCE = "connector-bundle";

const FORBIDDEN_NAME_TOKENS = new Set([
  "session",
  "sessions",
  "policy",
  "policies",
  "ceiling",
  "ceilings",
  "withdraw",
  "withdrawal",
  "pause",
  "unpause",
  "allowlist",
  "guardian",
  "guardians",
  "sign",
  "signer",
  "keypair",
  "mnemonic",
  "seed",
  "privkey",
]);
const FORBIDDEN_NAME_PHRASES = ["execute_payment", "private_key", "secret_key", "seed_phrase"];

/**
 * Checked token by token so `design_review` passes and `sign_tx` does not. Returns the
 * offending term, or null.
 */
export function forbiddenConnectorName(name: string): string | null {
  const lowered = name.toLowerCase();
  for (const phrase of FORBIDDEN_NAME_PHRASES) if (lowered.includes(phrase)) return phrase;
  for (const token of lowered.split(/[_-]+/)) if (FORBIDDEN_NAME_TOKENS.has(token)) return token;
  return null;
}

// The payment server's signer, RPC and ingest token share the runner's env. A bundle that
// could name them could put them in a header to its own host.
const RESERVED_ENV_PREFIXES = ["AGENT_RAILS_", "SOLANA_", "CONNECTOR_"];
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
const TOOL_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const BUNDLE_NAME = /^[a-z][a-z0-9-]{0,63}$/;
export const CONNECTOR_PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PATH_PARAM = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
const ENV_PLACEHOLDER = /\{\{ENV:([A-Z][A-Z0-9_]*)\}\}/g;
const JSON_TYPES = new Set(["string", "integer", "number", "boolean", "array", "object"]);
// Parameters become Python keyword arguments in the host.
const PYTHON_KEYWORDS = new Set(
  (
    "False None True and as assert async await break class continue def del elif else except " +
    "finally for from global if import in is lambda nonlocal not or pass raise return try " +
    "while with yield"
  ).split(" "),
);

const parametersSchema = z
  .strictObject({
    type: z.literal("object").default("object"),
    properties: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
    required: z.array(z.string()).default([]),
  })
  .superRefine((value, ctx) => {
    for (const [name, spec] of Object.entries(value.properties)) {
      if (!CONNECTOR_PARAM_NAME.test(name) || PYTHON_KEYWORDS.has(name)) {
        ctx.addIssue({ code: "custom", message: `parameter name '${name}' is not allowed` });
      }
      const kind = spec.type ?? "string";
      if (typeof kind !== "string" || !JSON_TYPES.has(kind)) {
        ctx.addIssue({ code: "custom", message: `parameter '${name}' has unsupported type` });
      }
    }
    const missing = value.required.filter((name) => !(name in value.properties));
    if (missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        message: `required parameters not declared: ${missing.join(", ")}`,
      });
    }
  });

export const connectorToolSchema = z
  .strictObject({
    name: z
      .string()
      .regex(TOOL_NAME)
      .superRefine((name, ctx) => {
        const term = forbiddenConnectorName(name);
        if (term) {
          ctx.addIssue({
            code: "custom",
            message: `tool name '${name}' is forbidden (governance or key term '${term}')`,
          });
        }
      }),
    description: z.string().max(1024).default(""),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
    url: z.string().min(1).max(2048),
    query: z.record(z.string(), z.string()).default({}),
    headers: z.record(z.string(), z.string()).default({}),
    body: z.record(z.string(), z.unknown()).nullable().default(null),
    argumentsIn: z.enum(["query", "body"]).nullable().default(null),
    parameters: parametersSchema.default({ type: "object", properties: {}, required: [] }),
  })
  .superRefine((tool, ctx) => {
    for (const [, name] of tool.url.matchAll(PATH_PARAM)) {
      if (name && !(name in tool.parameters.properties)) {
        ctx.addIssue({ code: "custom", message: `url parameter '{${name}}' is not declared` });
      }
    }
  });

export const connectorBundleSchema = z
  .strictObject({
    apiVersion: z.literal(CONNECTOR_API_VERSION).default(CONNECTOR_API_VERSION),
    name: z.string().regex(BUNDLE_NAME),
    description: z.string().max(2048).default(""),
    baseUrl: z.string().nullable().default(null),
    /** Env names the bundle reads; "" = the runner supplies it (kept on the MCP row). */
    env: z
      .record(z.string(), z.string())
      .default({})
      .superRefine((env, ctx) => {
        for (const key of Object.keys(env)) {
          if (!ENV_NAME.test(key) || RESERVED_ENV_PREFIXES.some((p) => key.startsWith(p))) {
            ctx.addIssue({ code: "custom", message: `env name '${key}' is not allowed` });
          }
        }
      }),
    instructions: z.string().max(16384).default(""),
    tools: z.array(connectorToolSchema).min(1).max(CONNECTOR_MAX_TOOLS),
  })
  .superRefine((bundle, ctx) => {
    const seen = new Set<string>();
    for (const tool of bundle.tools) {
      if (seen.has(tool.name)) {
        ctx.addIssue({ code: "custom", message: `duplicate tool name '${tool.name}'` });
      }
      seen.add(tool.name);
      if (!/^https?:\/\//.test(tool.url) && !bundle.baseUrl) {
        ctx.addIssue({
          code: "custom",
          message: `tool '${tool.name}' has a relative url and the bundle no baseUrl`,
        });
      }
      for (const value of [
        ...Object.values(tool.headers),
        ...Object.values(tool.query),
        tool.url,
      ]) {
        for (const [, ref] of value.matchAll(ENV_PLACEHOLDER)) {
          if (ref && !(ref in bundle.env)) {
            ctx.addIssue({
              code: "custom",
              message: `tool '${tool.name}' references {{ENV:${ref}}}, not declared in env`,
            });
          }
        }
      }
    }
  });

export type ConnectorBundle = z.infer<typeof connectorBundleSchema>;
export type ConnectorTool = z.infer<typeof connectorToolSchema>;

/** Env names the runner must fill before the bundle's tools can authenticate. */
export function connectorSecretEnv(bundle: ConnectorBundle): string[] {
  return Object.entries(bundle.env)
    .filter(([, value]) => value === "")
    .map(([key]) => key);
}

export type ConnectorProposal =
  | { ok: true; bundle: ConnectorBundle; raw: string }
  | { ok: false; error: string; raw: string };

/**
 * Pulls every ```connector-bundle fenced block out of a chat reply and validates it. Model
 * output is untrusted: a block that fails the schema is reported, never half-applied.
 */
export function extractConnectorProposals(text: string): ConnectorProposal[] {
  const fence = new RegExp(`\`\`\`${CONNECTOR_FENCE}[^\\n]*\\n([\\s\\S]*?)\`\`\``, "g");
  const out: ConnectorProposal[] = [];
  for (const match of text.matchAll(fence)) {
    const raw = (match[1] ?? "").trim();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      out.push({ ok: false, error: "not valid JSON", raw });
      continue;
    }
    const parsed = connectorBundleSchema.safeParse(data);
    out.push(
      parsed.success
        ? { ok: true, bundle: parsed.data, raw }
        : { ok: false, error: parsed.error.issues.map((i) => i.message).join("; "), raw },
    );
  }
  return out;
}
