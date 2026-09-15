import { readFile } from "node:fs/promises";
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
  /** Polls of the receipt PDA before an unknown outcome is reported as still unknown. */
  resolveAttempts: number;
  resolveIntervalMs: number;
  /** Local velocity cap, independent of the on-chain window limits (blueprint III-C). */
  maxPaymentsPerMinute: number;
  /** Symbol to mint address, for mints configured on the treasury. */
  mintAliases: Record<string, string>;
  /** JSONL path for the operator's payment record. Absent disables the sink. */
  sinkPath?: string;
};

export type McpRuntime = {
  rpc: Rpc<SolanaRpcApi>;
  config: McpServerConfig;
};

const DEFAULT_INTENT_TTL_SECONDS = 90;
const DEFAULT_CONFIRM_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_PAYMENTS_PER_MINUTE = 6;
const DEFAULT_RESOLVE_ATTEMPTS = 8;
const DEFAULT_RESOLVE_INTERVAL_MS = 750;

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
    maxPaymentsPerMinute: parsePositiveInt(
      env.AGENT_RAILS_MAX_PAYMENTS_PER_MINUTE,
      DEFAULT_MAX_PAYMENTS_PER_MINUTE,
      "AGENT_RAILS_MAX_PAYMENTS_PER_MINUTE",
    ),
    resolveAttempts: parsePositiveInt(
      env.AGENT_RAILS_RESOLVE_ATTEMPTS,
      DEFAULT_RESOLVE_ATTEMPTS,
      "AGENT_RAILS_RESOLVE_ATTEMPTS",
    ),
    resolveIntervalMs: parsePositiveInt(
      env.AGENT_RAILS_RESOLVE_INTERVAL_MS,
      DEFAULT_RESOLVE_INTERVAL_MS,
      "AGENT_RAILS_RESOLVE_INTERVAL_MS",
    ),
    mintAliases: parseAliases(env.AGENT_RAILS_MINT_ALIASES),
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
  return config;
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
