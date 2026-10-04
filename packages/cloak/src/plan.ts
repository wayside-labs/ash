import { type CloakPayoutProposal, parseSolToLamports } from "@agent-rails/contract/template-run";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { NETWORK_BUFFER_LAMPORTS } from "./constants.js";
import { RunError } from "./errors.js";
import { exitFeeLamports, netAfterExitFee, zecMinOutput } from "./fees.js";

export type PlanPayout = {
  index: number;
  label: string;
  address: string;
  deliver: "SOL" | "ZEC";
  /** SOL leaving the pool for this payee. */
  grossLamports: bigint;
  feeLamports: bigint;
  /** What the payee receives in SOL, or what is swapped into ZEC. */
  netLamports: bigint;
  /** ZEC payouts only; absent until a quote exists. */
  zec?: { quoteOutBaseUnits: bigint; minOutBaseUnits: bigint };
};

export type RunPlan = {
  runId: string;
  funder: string;
  payouts: PlanPayout[];
  /** One deposit funds every payout, so it is exactly their sum. */
  shieldLamports: bigint;
  totalFeeLamports: bigint;
  /** The shield plus what the wallet needs for rent and network fees. */
  requiredBalanceLamports: bigint;
  warnings: string[];
};

export type PlanInput = {
  runId: string;
  funder: string;
  /** Quoted ZEC out (base units) per payout index, for the payout's net SOL. */
  zecQuotes?: ReadonlyMap<number, bigint>;
};

/**
 * Turns a validated proposal into the numbers the card shows and the runner spends. Pure: the
 * quotes are an input, so the same proposal and quotes always give the same plan.
 */
export function buildRunPlan(proposal: CloakPayoutProposal, input: PlanInput): RunPlan {
  const warnings: string[] = [];
  const payouts: PlanPayout[] = proposal.payees.map((payee, index) => {
    const gross = parseSolToLamports(payee.amountSol);
    if (gross === null) throw new RunError("below_minimum", `payee ${index}: amount is not valid`);
    const fee = exitFeeLamports(gross);
    const net = netAfterExitFee(gross);
    if (net <= 0n)
      throw new RunError("below_minimum", `payee ${index}: nothing left after the fee`);

    const payout: PlanPayout = {
      index,
      label: payee.label,
      address: payee.address,
      deliver: payee.deliver,
      grossLamports: gross,
      feeLamports: fee,
      netLamports: net,
    };
    if (payee.deliver === "ZEC") {
      const quote = input.zecQuotes?.get(index);
      if (quote === undefined || quote <= 0n) {
        warnings.push(`No ZEC quote for payout ${index + 1}: refresh before running.`);
      } else {
        payout.zec = { quoteOutBaseUnits: quote, minOutBaseUnits: zecMinOutput(quote) };
      }
    }
    return payout;
  });

  const shield = payouts.reduce((sum, p) => sum + p.grossLamports, 0n);
  return {
    runId: input.runId,
    funder: input.funder,
    payouts,
    shieldLamports: shield,
    totalFeeLamports: payouts.reduce((sum, p) => sum + p.feeLamports, 0n),
    requiredBalanceLamports: shield + NETWORK_BUFFER_LAMPORTS,
    warnings,
  };
}

/**
 * A short digest of what a proposal would pay, for the key under which a browser remembers how far
 * a run got. Amounts count in lamports, so "0.02" and "0.020" are the same payout; the order stays,
 * because a log is indexed by position and the same payees in another order would read it wrong.
 * Labels are cosmetic and left out. A digest rather than the text: the payees' addresses are not
 * something to leave readable in a storage key.
 */
export function payoutDigest(proposal: CloakPayoutProposal): string {
  const material = proposal.payees
    .map(
      (payee) =>
        `${payee.address}:${payee.deliver}:${parseSolToLamports(payee.amountSol) ?? payee.amountSol}`,
    )
    .join(",");
  return bytesToHex(sha256(material)).slice(0, 16);
}

/** A short id for the timeline and the proof pack; not a secret and not a security boundary. */
export function newRunId(): string {
  return `run_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
