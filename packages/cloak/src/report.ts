import {
  CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
  PROOF_PACK_API_VERSION,
  type ProofPack,
  proofPackSchema,
  type RunEvent,
} from "@ash/contract/template-run";
import type { RunPlan } from "./plan.js";

/** What an earlier attempt already finished: signatures only, safe to keep in local storage. */
export type RunLog = {
  shieldSignature?: string;
  /**
   * A shield failed in a way that may have moved the deposit: no signature to cite, but not
   * proof it did not land. Running again would shield twice, so it blocks until a recovery looks.
   */
  shieldUncertain?: boolean;
  /** The memo transaction that committed the privacy text's hash, once it is confirmed. */
  commitSignature?: string;
  payoutSignatures: Record<number, string>;
};

export function emptyRunLog(): RunLog {
  return { payoutSignatures: {} };
}

/** Folds the timeline into the log, so the caller persists exactly what a resume needs. */
export function reduceRunLog(log: RunLog, event: RunEvent): RunLog {
  if (
    event.step === "shield" &&
    event.status === "failed" &&
    event.errorCode === "outcome_unknown"
  ) {
    return { ...log, shieldUncertain: true };
  }
  if (event.status !== "done" || !event.signature) return log;
  if (event.step === "shield") {
    const { shieldUncertain: _certain, ...rest } = log;
    return { ...rest, shieldSignature: event.signature };
  }
  if (event.step === "commit") return { ...log, commitSignature: event.signature };
  if (event.step === "payout" && event.payeeIndex !== undefined) {
    return {
      ...log,
      payoutSignatures: { ...log.payoutSignatures, [event.payeeIndex]: event.signature },
    };
  }
  return log;
}

/**
 * The limits a judge should read next to the signatures. They are part of the proof on purpose:
 * a pack that only showed the flattering half would be marketing, not evidence.
 */
export const PROOF_NOTES: readonly string[] = [
  "Deposit and withdrawal amounts are public on-chain; what the pool hides is which deposit became which payout.",
  "Cloak's relay authenticates the signing wallet and receives its viewing key, which for these notes is enough to rebuild their keys: nothing here is hidden from the relay.",
  "Payee addresses appear in this pack on purpose, so the run can be checked; on-chain there is no direct link from the funder to them, though amounts and timing can still be correlated.",
  "ZEC delivered on Solana is an ordinary SPL token until it is shielded in a Zcash wallet.",
  "Fees are the schedule the SDK documents (0.005 SOL + 0.3% per payout); the pool's on-chain configuration is what applies.",
];

export type ProofInput = {
  plan: RunPlan;
  log: RunLog;
  /** The memo the commitment carried, to be shown beside its signature. */
  commitment?: { memo: string };
  startedAt: string;
  finishedAt: string;
  sdkVersion: string;
  programId: string;
};

/**
 * Builds the pack and validates it against its own schema: a run that lost a signature cannot
 * produce a pack that looks complete, and a stray field cannot ride along into the repository.
 */
export function buildProofPack(input: ProofInput): ProofPack {
  const { plan, log } = input;
  if (!log.shieldSignature) throw new Error("the run has no shield signature");
  return proofPackSchema.parse({
    apiVersion: PROOF_PACK_API_VERSION,
    template: CLOAK_PRIVATE_PAYOUT_TEMPLATE_ID,
    runId: plan.runId,
    cluster: "mainnet-beta",
    cloakProgramId: input.programId,
    sdk: { name: "@cloak.dev/sdk", version: input.sdkVersion },
    funder: plan.funder,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    shield: {
      signature: log.shieldSignature,
      amountLamports: plan.shieldLamports.toString(),
    },
    ...(log.commitSignature && input.commitment
      ? { commitment: { signature: log.commitSignature, memo: input.commitment.memo } }
      : {}),
    payouts: plan.payouts.map((payout) => ({
      index: payout.index,
      label: payout.label,
      address: payout.address,
      deliver: payout.deliver,
      grossLamports: payout.grossLamports.toString(),
      feeLamports: payout.feeLamports.toString(),
      netLamports: payout.netLamports.toString(),
      ...(payout.zec ? { minOutputBaseUnits: payout.zec.minOutBaseUnits.toString() } : {}),
      signature: log.payoutSignatures[payout.index],
    })),
    notes: [...PROOF_NOTES],
  });
}
