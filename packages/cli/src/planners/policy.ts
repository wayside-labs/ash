import type {
  MintCeiling,
  MintLimit,
  PolicyInput,
  PolicyInputArgs,
  Treasury,
} from "@agent-rails/client";
import { NATIVE_MINT } from "@agent-rails/contract";
import { type Address, address } from "@solana/kit";
import { CliError } from "../errors.js";

const DESTINATION_MODE_ALLOWLIST = 1;
const ZERO_RESERVED = new Uint8Array(12);

export type LimitDraft = {
  perTxMax: bigint;
  shortWindowMax: bigint;
  shortWindowSeconds: number;
  longWindowMax: bigint;
  longWindowSeconds: number;
  lifetimeMax: bigint;
};

/** Partial order between an operator limit and the owner's ceiling (policy crate). */
export function limitLeqCeiling(limit: LimitDraft, ceiling: MintCeiling): boolean {
  return (
    limit.perTxMax <= ceiling.maxPerTx &&
    limit.shortWindowMax <= ceiling.maxShortWindow &&
    limit.longWindowMax <= ceiling.maxLongWindow &&
    limit.lifetimeMax <= ceiling.maxLifetime &&
    limit.shortWindowSeconds >= ceiling.minShortWindowSeconds &&
    limit.longWindowSeconds >= ceiling.minLongWindowSeconds
  );
}

export function mintLimitFromDraft(mint: Address, draft: LimitDraft): MintLimit {
  return {
    mint,
    perTxMax: draft.perTxMax,
    shortWindowMax: draft.shortWindowMax,
    shortWindowSeconds: draft.shortWindowSeconds,
    longWindowMax: draft.longWindowMax,
    longWindowSeconds: draft.longWindowSeconds,
    lifetimeMax: draft.lifetimeMax,
    approvalThreshold: 0n,
    cooldownSeconds: 0,
    reserved: ZERO_RESERVED,
  };
}

export function buildPolicyInput(
  mintLimits: MintLimit[],
  destinationMode: number,
  requireMemo: boolean,
  createDestinationAta: boolean,
): PolicyInput {
  return {
    mintLimits,
    destinationMode,
    requireMemo,
    createDestinationAta,
  };
}

export function preflightPolicyLeqCeiling(
  policy: PolicyInputArgs,
  treasury: Treasury,
  formatHint: (mint: Address) => string,
): void {
  if (policy.mintLimits.length === 0) {
    throw new CliError("Policy must include at least one mint limit");
  }

  for (const limit of policy.mintLimits) {
    const config = treasury.mints
      .slice(0, treasury.mintCount)
      .find((entry) => entry.mint === limit.mint);
    if (!config) {
      throw new CliError(`Mint ${limit.mint} has no ceiling on this treasury`, {
        hint: "Add the mint with add_mint before setting a policy limit for it.",
      });
    }
    const draft: LimitDraft = {
      perTxMax: BigInt(limit.perTxMax),
      shortWindowMax: BigInt(limit.shortWindowMax),
      shortWindowSeconds: limit.shortWindowSeconds,
      longWindowMax: BigInt(limit.longWindowMax),
      longWindowSeconds: limit.longWindowSeconds,
      lifetimeMax: BigInt(limit.lifetimeMax),
    };
    if (!limitLeqCeiling(draft, config.ceiling)) {
      throw new CliError(`Policy limit for ${formatHint(limit.mint)} exceeds the owner ceiling`, {
        hint: `Raise the ceiling first: agent-rails ceiling set --mint ${limit.mint === address(NATIVE_MINT) ? "SOL" : limit.mint} ...`,
      });
    }
  }

  if (policy.createDestinationAta && !treasury.allowCreateDestinationAta) {
    throw new CliError(
      "Policy cannot allow creating destination ATAs — treasury ceiling forbids it",
    );
  }
  if (policy.destinationMode !== DESTINATION_MODE_ALLOWLIST && !treasury.allowAnyDestination) {
    throw new CliError("Policy destination mode exceeds treasury ceiling");
  }
}

export function applyLimitDelta(current: MintLimit, delta: Partial<LimitDraft>): MintLimit {
  return {
    ...current,
    perTxMax: delta.perTxMax ?? current.perTxMax,
    shortWindowMax: delta.shortWindowMax ?? current.shortWindowMax,
    shortWindowSeconds: delta.shortWindowSeconds ?? current.shortWindowSeconds,
    longWindowMax: delta.longWindowMax ?? current.longWindowMax,
    longWindowSeconds: delta.longWindowSeconds ?? current.longWindowSeconds,
    lifetimeMax: delta.lifetimeMax ?? current.lifetimeMax,
  };
}
