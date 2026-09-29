import { readFile } from "node:fs/promises";
import {
  SECURITY_PRESET_NAMES,
  type SecurityPosture,
  type SecurityPresetName,
} from "@agent-rails/contract";
import { type Address, createSolanaRpc, type Rpc, type SolanaRpcApi } from "@solana/kit";

/**
 * Server configuration.
 *
 * `session` is required and is the anchor of the whole design: this process serves exactly
 * one agent session, resolved here and never taken from a tool argument. Everything else
 * about the treasury — which policy, which mints, which destinations — is derived from it
 * on-chain at startup rather than supplied by a caller (blueprint I-1).
 */
export type McpServerConfig = {
  rpcUrl: string;
  /** AgentSession PDA this server is bound to. */
  session: Address;
  /** Local keypair path. Empty when a remote signer is configured. */
  signerKeypairPath: string;
  /** Signing service holding the session key outside this process (blueprint III-G). */
  remoteSigner?: { url: string; address: string; token?: string };
  feePayerKeypairPath?: string;
  /** Seconds added to `now` for `PaymentIntent.expires_at`. The program allows 5 to 3600. */
  intentTtlSeconds: number;
  confirmTimeoutMs: number;
  /**
   * Off-chain guard-rail posture.
   *
   * A preset plus whatever the environment overrode. The on-chain program is unaffected by
   * every field here; this only decides how much the client refuses on its own.
   */
  securityPreset: SecurityPresetName;
  securityOverrides: Partial<SecurityPosture>;
  /** Symbol to mint address, for mints configured on the treasury. */
  mintAliases: Record<string, string>;
  /** JSONL path for the operator's payment record. Absent disables the sink. */
  sinkPath?: string;
  /** HTTPS webhook for `payment_denied` alerts (generic URL or Slack incoming webhook). */
  alertWebhookUrl?: string;
  /**
   * The operator dashboard's ingest API (`https://<dashboard>/api/ingest`) and the workflow
   * token it issued. Events go to `<url>/events`; review decisions come from
   * `<url>/reviews/<intent_id>`. Both or neither.
   */
  ingest?: { url: string; token: string };
  /**
   * When `readonly`, registers check/list/status tools only — no `execute_payment`.
   * Useful for planner agents that must simulate spend without signing.
   */
  toolsMode: "full" | "readonly";
};

export type McpRuntime = {
  rpc: Rpc<SolanaRpcApi>;
  config: McpServerConfig;
};

const DEFAULT_INTENT_TTL_SECONDS = 90;
const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;

/** The native SOL sentinel is always addressable, whatever the operator configured. */
const BUILTIN_MINT_ALIASES: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  WSOL: "So11111111111111111111111111111111111111112",
};

function parseAliases(raw: string | undefined): Record<string, string> {
  const aliases = { ...BUILTIN_MINT_ALIASES };
  if (!raw) return aliases;

  for (const pair of raw.split(",")) {
    const trimmed = pair.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      throw new Error(`AGENT_RAILS_MINT_ALIASES entry "${trimmed}" must be SYMBOL:address`);
    }
    const symbol = trimmed.slice(0, separator).trim().toUpperCase();
    const address = trimmed.slice(separator + 1).trim();
    if (!symbol || !address) {
      throw new Error(`AGENT_RAILS_MINT_ALIASES entry "${trimmed}" must be SYMBOL:address`);
    }
    aliases[symbol] = address;
  }
  return aliases;
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv = process.env): McpServerConfig {
  const rpcUrl = env.AGENT_RAILS_RPC;
  const session = env.AGENT_RAILS_SESSION;
  const signerKeypairPath = env.AGENT_RAILS_SIGNER ?? env.AGENT_RAILS_SESSION_SIGNER;
  const feePayerKeypairPath = env.AGENT_RAILS_FEE_PAYER;

  if (!rpcUrl) {
    throw new Error("AGENT_RAILS_RPC is required");
  }
  if (!session) {
    throw new Error(
      "AGENT_RAILS_SESSION (AgentSession PDA) is required: the server binds to one session " +
        "at startup and will not accept one as a tool argument",
    );
  }
  const remoteSignerUrl = env.AGENT_RAILS_REMOTE_SIGNER_URL;
  const remoteSignerAddress = env.AGENT_RAILS_REMOTE_SIGNER_ADDRESS;

  if (remoteSignerUrl && !remoteSignerAddress) {
    throw new Error(
      "AGENT_RAILS_REMOTE_SIGNER_ADDRESS is required with AGENT_RAILS_REMOTE_SIGNER_URL: " +
        "the signer's public key is checked against the on-chain session key at startup",
    );
  }
  if (!remoteSignerUrl && !signerKeypairPath) {
    throw new Error(
      "A session signer is required: set AGENT_RAILS_SIGNER (keypair path) or " +
        "AGENT_RAILS_REMOTE_SIGNER_URL with AGENT_RAILS_REMOTE_SIGNER_ADDRESS",
    );
  }

  const intentTtlSeconds = parsePositiveInt(
    env.AGENT_RAILS_INTENT_TTL_SECONDS,
    DEFAULT_INTENT_TTL_SECONDS,
    "AGENT_RAILS_INTENT_TTL_SECONDS",
  );
  if (intentTtlSeconds < 5 || intentTtlSeconds > 3_600) {
    throw new Error("AGENT_RAILS_INTENT_TTL_SECONDS must be between 5 and 3600");
  }

  const config: McpServerConfig = {
    rpcUrl,
    session: session as Address,
    signerKeypairPath: signerKeypairPath ?? "",
    intentTtlSeconds,
    confirmTimeoutMs: parsePositiveInt(
      env.AGENT_RAILS_CONFIRM_TIMEOUT_MS,
      DEFAULT_CONFIRM_TIMEOUT_MS,
      "AGENT_RAILS_CONFIRM_TIMEOUT_MS",
    ),
    securityPreset: parsePreset(env.AGENT_RAILS_SECURITY),
    securityOverrides: parseSecurityOverrides(env),
    mintAliases: parseAliases(env.AGENT_RAILS_MINT_ALIASES),
    toolsMode: "full",
  };
  if (remoteSignerUrl && remoteSignerAddress) {
    config.remoteSigner = {
      url: remoteSignerUrl,
      address: remoteSignerAddress,
      ...(env.AGENT_RAILS_REMOTE_SIGNER_TOKEN
        ? { token: env.AGENT_RAILS_REMOTE_SIGNER_TOKEN }
        : {}),
    };
  }
  if (feePayerKeypairPath) {
    config.feePayerKeypairPath = feePayerKeypairPath;
  }
  if (env.AGENT_RAILS_SINK) {
    config.sinkPath = env.AGENT_RAILS_SINK;
  }
  const alertWebhook = env.AGENT_RAILS_ALERT_WEBHOOK_URL?.trim();
  if (alertWebhook) {
    config.alertWebhookUrl = alertWebhook;
  }
  const ingestUrl = env.AGENT_RAILS_INGEST_URL?.trim();
  const ingestToken = env.AGENT_RAILS_INGEST_TOKEN?.trim();
  if (Boolean(ingestUrl) !== Boolean(ingestToken)) {
    throw new Error("AGENT_RAILS_INGEST_URL and AGENT_RAILS_INGEST_TOKEN go together");
  }
  if (ingestUrl && ingestToken) {
    const parsed = new URL(ingestUrl);
    // A bearer token over plain HTTP is readable by anyone on the path; loopback is the one
    // place that is not true, and it is where a local dashboard runs.
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
      throw new Error("AGENT_RAILS_INGEST_URL must be https (http only for localhost)");
    }
    config.ingest = { url: ingestUrl.replace(/\/+$/, ""), token: ingestToken };
  }
  const toolsRaw = env.AGENT_RAILS_TOOLS?.trim().toLowerCase();
  if (toolsRaw === "readonly" || toolsRaw === "read-only") {
    config.toolsMode = "readonly";
  } else if (toolsRaw === "full" || toolsRaw === undefined || toolsRaw === "") {
    config.toolsMode = "full";
  } else {
    throw new Error(
      `AGENT_RAILS_TOOLS must be "full" or "readonly"; got ${JSON.stringify(toolsRaw)}`,
    );
  }
  return config;
}

function parsePreset(raw: string | undefined): SecurityPresetName {
  if (raw === undefined) return "balanced";
  const candidate = raw.trim().toLowerCase() as SecurityPresetName;
  if (!SECURITY_PRESET_NAMES.includes(candidate)) {
    throw new Error(
      `AGENT_RAILS_SECURITY must be one of: ${SECURITY_PRESET_NAMES.join(", ")}; got ` +
        JSON.stringify(raw),
    );
  }
  return candidate;
}

/**
 * Individual knobs from the environment, layered onto the preset.
 *
 * Deployments that cannot pass a config object still need to reach the important dials, and
 * these are the ones that come up: throughput, and how hard to poll an unknown outcome.
 * Anything richer — value bands, hooks — is a config object, because it does not survive
 * being flattened into strings.
 */
function parseSecurityOverrides(env: NodeJS.ProcessEnv): Partial<SecurityPosture> {
  const overrides: Partial<SecurityPosture> = {};

  const perMinute = env.AGENT_RAILS_MAX_PAYMENTS_PER_MINUTE;
  const concurrent = env.AGENT_RAILS_MAX_CONCURRENT;
  if (perMinute !== undefined || concurrent !== undefined) {
    overrides.velocity = {
      ...(perMinute !== undefined
        ? {
            maxPaymentsPerMinute: parsePositiveInt(
              perMinute,
              0,
              "AGENT_RAILS_MAX_PAYMENTS_PER_MINUTE",
            ),
          }
        : {}),
      ...(concurrent !== undefined
        ? { maxConcurrent: parsePositiveInt(concurrent, 0, "AGENT_RAILS_MAX_CONCURRENT") }
        : {}),
    } as SecurityPosture["velocity"];
  }

  const attempts = env.AGENT_RAILS_RESOLVE_ATTEMPTS;
  const interval = env.AGENT_RAILS_RESOLVE_INTERVAL_MS;
  if (attempts !== undefined || interval !== undefined) {
    overrides.outcomes = {
      ...(attempts !== undefined
        ? { resolveAttempts: parsePositiveInt(attempts, 0, "AGENT_RAILS_RESOLVE_ATTEMPTS") }
        : {}),
      ...(interval !== undefined
        ? {
            resolveIntervalMs: parsePositiveInt(interval, 0, "AGENT_RAILS_RESOLVE_INTERVAL_MS"),
          }
        : {}),
    } as SecurityPosture["outcomes"];
  }

  return overrides;
}

export function createRuntime(config: McpServerConfig): McpRuntime {
  return {
    config,
    rpc: createSolanaRpc(config.rpcUrl),
  };
}

export async function readKeypairBytes(path: string): Promise<Uint8Array> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as number[];
  return Uint8Array.from(parsed);
}
