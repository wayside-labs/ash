import {
  type AgentSession,
  fetchMaybeAgentSession,
  fetchMaybePolicy,
  fetchMaybeTreasury,
  type Policy,
  type Treasury,
} from "@agent-rails/client";
import { AUTH_MODE_DIRECT_SIGNER, NATIVE_MINT } from "@agent-rails/contract";
import { AgentRailsError, type DestinationIndex, loadDestinationIndex } from "@agent-rails/sdk";
import type { Address } from "@solana/kit";
import type { McpRuntime } from "./config.js";
import type { SessionSigners } from "./session.js";

/**
 * Process identity, resolved once from the chain (blueprint I-1).
 *
 * The treasury, policy, mint table and destination index are all derived from the one
 * session address in configuration. None of them is reachable from a tool argument, so an
 * injected instruction has nothing to point somewhere else: the most privileged fields in
 * the old payload are now not fields at all.
 *
 * Binding happens at startup and failure is fatal. A server that cannot establish what it
 * is for should not reach a state where it can be asked to pay someone.
 */

export type BoundMint = {
  symbol?: string;
  mint: Address;
  decimals: number;
  tokenProgram: Address;
  isNative: boolean;
  /** True when the bound policy also carries a limit slot for this mint. */
  inPolicy: boolean;
};

export type BoundContext = {
  treasury: Address;
  policy: Address;
  session: Address;
  sessionKey: Address;
  /** 0 = Any, 1 = Allowlist. */
  destinationMode: number;
  requireMemo: boolean;
  mints: BoundMint[];
  destinations: DestinationIndex;
  boundAt: number;
};

export const DESTINATION_MODE_ANY = 0;
export const DESTINATION_MODE_ALLOWLIST = 1;

/** Startup failure. Distinct from a payment denial: nothing is running yet. */
export class BindingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BindingError";
  }
}

function buildMintTable(
  treasury: Treasury,
  policy: Policy,
  aliases: Record<string, string>,
): BoundMint[] {
  const symbolByAddress = new Map<string, string>();
  for (const [symbol, address] of Object.entries(aliases)) {
    if (!symbolByAddress.has(address)) {
      symbolByAddress.set(address, symbol);
    }
  }

  const policyMints = new Set(
    policy.mintLimits.slice(0, policy.mintCount).map((limit) => String(limit.mint)),
  );

  return treasury.mints.slice(0, treasury.mintCount).map((config) => {
    const mint = config.mint;
    const symbol = symbolByAddress.get(String(mint));
    return {
      ...(symbol ? { symbol } : {}),
      mint,
      decimals: config.decimals,
      tokenProgram: config.tokenProgram,
      isNative: String(mint) === NATIVE_MINT,
      inPolicy: policyMints.has(String(mint)),
    };
  });
}

/**
 * Resolve and validate everything this server is allowed to touch.
 *
 * The signer check is the important one: a keypair that is not this session's `session_key`
 * can never produce a valid payment, so starting up with one is a misconfiguration that
 * would otherwise surface as a stream of confusing on-chain denials.
 */
export async function bindSession(
  runtime: McpRuntime,
  signers: SessionSigners,
): Promise<BoundContext> {
  const sessionAddress = runtime.config.session;

  const sessionAccount = await fetchMaybeAgentSession(runtime.rpc, sessionAddress);
  if (!sessionAccount.exists) {
    throw new BindingError(`AgentSession ${sessionAddress} does not exist`);
  }
  const session: AgentSession = sessionAccount.data;

  if (String(session.sessionKey) !== String(signers.sessionKey.address)) {
    throw new BindingError(
      `Configured signer ${signers.sessionKey.address} is not the session key ` +
        `${session.sessionKey} for ${sessionAddress}`,
    );
  }
  if (session.authMode !== AUTH_MODE_DIRECT_SIGNER) {
    throw new BindingError(
      `AgentSession ${sessionAddress} uses auth_mode ${session.authMode}; this client only ` +
        "supports direct session signing",
    );
  }
  if (session.revoked) {
    throw new BindingError(`AgentSession ${sessionAddress} has been revoked`);
  }
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now >= session.expiresAt) {
    throw new BindingError(`AgentSession ${sessionAddress} expired at ${session.expiresAt}`);
  }

  const treasuryAccount = await fetchMaybeTreasury(runtime.rpc, session.treasury);
  if (!treasuryAccount.exists) {
    throw new BindingError(`Treasury ${session.treasury} does not exist`);
  }
  const policyAccount = await fetchMaybePolicy(runtime.rpc, session.policy);
  if (!policyAccount.exists) {
    throw new BindingError(`Policy ${session.policy} does not exist`);
  }

  const mints = buildMintTable(
    treasuryAccount.data,
    policyAccount.data,
    runtime.config.mintAliases,
  );

  // In allowlist mode the index is the only way to name a destination, so failing to load
  // it means the server cannot pay anyone correctly. Refusing to start beats starting up
  // and denying every request for a reason nobody can see.
  let destinations: DestinationIndex;
  try {
    destinations = await loadDestinationIndex({
      rpc: runtime.rpc as never,
      policy: session.policy,
    });
  } catch (error) {
    throw new BindingError(
      `Could not load the destination allowlist for policy ${session.policy}: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (
    policyAccount.data.destinationMode === DESTINATION_MODE_ALLOWLIST &&
    destinations.entries.length === 0
  ) {
    throw new BindingError(
      `Policy ${session.policy} is in Allowlist mode but has no registered destinations`,
    );
  }

  return {
    treasury: session.treasury,
    policy: session.policy,
    session: sessionAddress,
    sessionKey: session.sessionKey,
    destinationMode: policyAccount.data.destinationMode,
    requireMemo: policyAccount.data.requireMemo,
    mints,
    destinations,
    boundAt: Date.now(),
  };
}

/**
 * Re-read the three things that can turn a valid session into an invalid one.
 *
 * The program checks all of these anyway; doing it here means the guardian's kill switch
 * takes effect at the mediation plane too, without spending a transaction fee to discover
 * it. An RPC failure denies rather than falling back to what was true at startup — a cached
 * `paused: false` is exactly the value an attacker would want us to keep using.
 */
export async function assertSessionLive(runtime: McpRuntime, bound: BoundContext): Promise<void> {
  let treasury: Treasury;
  let session: AgentSession;

  try {
    const [treasuryAccount, sessionAccount] = await Promise.all([
      fetchMaybeTreasury(runtime.rpc, bound.treasury),
      fetchMaybeAgentSession(runtime.rpc, bound.session),
    ]);
    if (!treasuryAccount.exists || !sessionAccount.exists) {
      throw new Error("treasury or session account is missing");
    }
    treasury = treasuryAccount.data;
    session = sessionAccount.data;
  } catch (error) {
    throw new AgentRailsError({
      reasonCode: "STATE_UNAVAILABLE",
      message:
        "Could not read on-chain session state, so liveness could not be established. " +
        "No payment was attempted.",
      outcome: "denied",
      source: "resolver",
      cause: error,
    });
  }

  if (treasury.paused) {
    throw new AgentRailsError({
      reasonCode: "TREASURY_PAUSED",
      message: "The treasury is paused. Agent payments are stopped until an owner unpauses.",
      outcome: "denied",
      source: "resolver",
    });
  }
  if (session.revoked) {
    throw new AgentRailsError({
      reasonCode: "SESSION_REVOKED",
      message: "This agent session has been revoked.",
      outcome: "denied",
      source: "resolver",
    });
  }
  if (BigInt(Math.floor(Date.now() / 1000)) >= session.expiresAt) {
    throw new AgentRailsError({
      reasonCode: "SESSION_EXPIRED",
      message: "This agent session has expired.",
      outcome: "denied",
      source: "resolver",
    });
  }
}

/** Resolve a mint symbol or address against the owner-configured treasury mint table. */
export function resolveMint(bound: BoundContext, ref: string): BoundMint {
  const upper = ref.toUpperCase();
  const bySymbol = bound.mints.find((mint) => mint.symbol === upper);
  const match = bySymbol ?? bound.mints.find((mint) => String(mint.mint) === ref);

  if (!match) {
    const known = bound.mints.map((mint) => mint.symbol ?? String(mint.mint)).join(", ");
    throw new AgentRailsError({
      reasonCode: "UNKNOWN_MINT",
      message: `"${ref}" is not a mint configured on this treasury. Available: ${known || "none"}.`,
      outcome: "denied",
      source: "resolver",
    });
  }

  if (!match.inPolicy) {
    throw new AgentRailsError({
      reasonCode: "MINT_NOT_IN_POLICY",
      message: `The bound policy has no spending limit for ${match.symbol ?? match.mint}.`,
      outcome: "denied",
      source: "resolver",
    });
  }

  return match;
}
