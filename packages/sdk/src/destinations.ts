import {
  AGENT_RAILS_PROGRAM_ADDRESS,
  ALLOWLIST_ENTRY_DISCRIMINATOR,
  getAllowlistEntryDecoder,
} from "@agent-rails/client";
import { type Address, getBase58Decoder, getBase64Encoder } from "@solana/kit";
import { AgentRailsError } from "./errors.js";

/**
 * Label to pubkey resolution against the on-chain allowlist (blueprint II-1).
 *
 * The set of `AllowlistEntry` PDAs under a policy is the naming authority for destinations,
 * because an operator created each one out of band and no caller can invent another. That
 * makes the resolver one-way by design: a label resolves to an address, and there is no
 * path in the other direction — no fuzzy match, no nearest neighbour, no "did you mean".
 * Those conveniences are precisely the attack, since the whole value of the allowlist is
 * that a close-enough name does not get paid.
 *
 * The program separately derives the destination ATA from the owner, so look-alike token
 * accounts are already impossible (ADR-005). This closes the remaining gap: look-alike
 * owners.
 */

/** Offset of `policy` in `AllowlistEntry`: discriminator(8) + version(1) + bump(1). */
const POLICY_FIELD_OFFSET = 10n;

export type DestinationEntry = {
  /** As stored on-chain, trailing zero padding removed. */
  label: string;
  normalizedLabel: string;
  owner: Address;
  entry: Address;
  /** 0 means "no override"; otherwise it caps this destination below the policy limit. */
  perTxMaxOverride: bigint;
};

export type DestinationIndex = {
  policy: Address;
  entries: DestinationEntry[];
  loadedAt: number;
};

const BASE58_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/**
 * Fold away the differences that look identical to a human and are not to a byte
 * comparison: case, surrounding space, repeated space, and the compatibility forms that let
 * a visually identical label be a different string.
 */
export function normalizeLabel(label: string): string {
  return label.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");
}

function decodeLabel(bytes: Uint8Array | ReadonlyArray<number>): string {
  const array = Uint8Array.from(bytes as ArrayLike<number>);
  const end = array.indexOf(0);
  return new TextDecoder().decode(end === -1 ? array : array.subarray(0, end));
}

type ProgramAccount = {
  pubkey: Address;
  account: { data: [string, string] | string };
};

/**
 * Only the slice of the RPC surface this needs, spelled out rather than borrowed from
 * `Rpc<SolanaRpcApi>`, so a caller can pass a test double without reconstructing the whole
 * API type.
 */
export type ProgramAccountsRpc = {
  getProgramAccounts(
    program: Address,
    config: {
      encoding: "base64";
      filters: ReadonlyArray<{
        memcmp: { offset: bigint; bytes: string; encoding: "base58" };
      }>;
    },
  ): { send(): Promise<readonly ProgramAccount[]> };
};

export type LoadDestinationIndexInput = {
  rpc: ProgramAccountsRpc;
  policy: Address;
};

/**
 * Read every allowlist entry for a policy.
 *
 * Filtered server-side by discriminator and by the policy field, so an unrelated account
 * cannot enter the index even if it happens to sit under the same program.
 */
export async function loadDestinationIndex(
  input: LoadDestinationIndexInput,
): Promise<DestinationIndex> {
  const discriminator = getBase58Decoder().decode(ALLOWLIST_ENTRY_DISCRIMINATOR);

  const accounts = await input.rpc
    .getProgramAccounts(AGENT_RAILS_PROGRAM_ADDRESS as Address, {
      encoding: "base64",
      filters: [
        { memcmp: { offset: 0n, bytes: discriminator, encoding: "base58" } },
        { memcmp: { offset: POLICY_FIELD_OFFSET, bytes: input.policy, encoding: "base58" } },
      ],
    })
    .send();

  const decoder = getAllowlistEntryDecoder();
  const base64 = getBase64Encoder();

  const entries: DestinationEntry[] = accounts.map((account) => {
    const raw = Array.isArray(account.account.data)
      ? account.account.data[0]
      : account.account.data;
    const decoded = decoder.decode(base64.encode(raw));
    const label = decodeLabel(decoded.label as unknown as Uint8Array);
    return {
      label,
      normalizedLabel: normalizeLabel(label),
      owner: decoded.destinationOwner,
      entry: account.pubkey,
      perTxMaxOverride: decoded.perTxMaxOverride,
    };
  });

  return { policy: input.policy, entries, loadedAt: Date.now() };
}

export type ResolveDestinationInput = {
  index: DestinationIndex;
  ref: string;
  /**
   * Only true for a policy in `Any` mode. In `Allowlist` mode a raw address is refused
   * outright: an address is a value a caller can author, and a label is not.
   */
  allowRawAddress: boolean;
};

export type ResolvedDestination = {
  owner: Address;
  label?: string;
  entry?: Address;
  perTxMaxOverride?: bigint;
};

/** Levenshtein distance, capped: only used to decide whether a miss is worth alerting on. */
export function editDistance(a: string, b: string, cap = 3): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      const deletion = (previous[j] ?? 0) + 1;
      const insertion = (current[j - 1] ?? 0) + 1;
      current[j] = Math.min(substitution, deletion, insertion);
    }
    previous = current;
  }
  return previous[b.length] ?? cap + 1;
}

/** Registered labels close enough to a miss to look like an impersonation attempt. */
export function nearMisses(index: DestinationIndex, ref: string, maxDistance = 2): string[] {
  const normalized = normalizeLabel(ref);
  return index.entries
    .filter((entry) => editDistance(entry.normalizedLabel, normalized, maxDistance) <= maxDistance)
    .map((entry) => entry.label);
}

/**
 * Resolve a destination reference to a wallet owner.
 *
 * Exact match on the normalized label, or nothing. Two entries normalizing to one label is
 * refused rather than disambiguated, because that collision is either an operator mistake
 * or someone registering a look-alike, and paying either one is wrong.
 */
export function resolveDestination(input: ResolveDestinationInput): ResolvedDestination {
  const normalized = normalizeLabel(input.ref);
  const matches = input.index.entries.filter((entry) => entry.normalizedLabel === normalized);

  if (matches.length > 1) {
    throw new AgentRailsError({
      reasonCode: "AMBIGUOUS_DESTINATION",
      message:
        `Destination "${input.ref}" matches ${matches.length} allowlist entries ` +
        "(possible impersonation). Payment refused.",
      outcome: "denied",
      source: "resolver",
    });
  }

  const match = matches[0];
  if (match) {
    return {
      owner: match.owner,
      label: match.label,
      entry: match.entry,
      perTxMaxOverride: match.perTxMaxOverride,
    };
  }

  if (BASE58_ADDRESS.test(input.ref)) {
    if (!input.allowRawAddress) {
      throw new AgentRailsError({
        reasonCode: "LITERAL_NOT_PERMITTED",
        message:
          "This policy pays registered destinations only. Use a destination label; " +
          "raw addresses are not accepted.",
        outcome: "denied",
        source: "resolver",
      });
    }
    return { owner: input.ref as Address };
  }

  // Deliberately no suggestion in the message: naming the near miss hands an attacker the
  // correct label, and hands a confused agent a value it did not have.
  throw new AgentRailsError({
    reasonCode: "UNKNOWN_DESTINATION",
    message: `No allowlisted destination is registered under "${input.ref}".`,
    outcome: "denied",
    source: "resolver",
  });
}
