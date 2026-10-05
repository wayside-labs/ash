import {
  isTransactionSignature,
  type ProofPack,
  type RunErrorCode,
  type RunEvent,
  type RunStep,
  runEventSchema,
  SYSTEM_PROGRAM_ADDRESS,
} from "@ash/contract/template-run";
import { classifyError, describeForConsole, RunError } from "./errors.js";
import { obtainMasterSeed } from "./keys.js";
import type { RunPlan } from "./plan.js";
import type { PayoutSession, SdkPort, TxReceipt, WalletPort } from "./ports.js";
import { buildProofPack, emptyRunLog, type RunLog } from "./report.js";

export type RunnerDeps = {
  sdk: SdkPort;
  wallet: WalletPort;
  emit: (event: RunEvent) => void;
  now?: () => Date;
  signal?: AbortSignal;
  /**
   * The public checksum stored by an earlier run on this device. A different value means the
   * wallet now derives different keys, which is caught before anything is shielded.
   */
  expectFingerprint?: string;
  /** Called as soon as the keys exist, so the caller can store the checksum even if the run fails. */
  onFingerprint?: (fingerprint: string) => void;
  /** What an earlier attempt already finished. */
  resume?: RunLog;
  /**
   * A text to write on-chain right after the deposit, in a transaction of its own: the commitment
   * half of the privacy text's proof of existence. Optional, and never allowed to stop a run: the
   * deposit has moved by then, and a hash that could not be written can be written again alone.
   */
  commitment?: { memo: string };
  /**
   * Called with the runner's own log every time it changes. Persist from this and not from the
   * events: an event that fails its schema is dropped, and a log rebuilt from events would then be
   * missing a signature the run really holds.
   */
  onLog?: (log: RunLog) => void;
};

export type RunOutcome = {
  proof: ProofPack;
  csv: string;
  fingerprint: string;
  log: RunLog;
};

type EventExtra = {
  payeeIndex?: number;
  signature?: string;
  errorCode?: RunErrorCode;
  message?: string;
};

function makeEmitter(deps: RunnerDeps, runId: string) {
  const now = deps.now ?? (() => new Date());
  return (step: RunStep, status: RunEvent["status"], extra: EventExtra = {}): void => {
    const parsed = runEventSchema.safeParse({
      runId,
      at: now().toISOString(),
      step,
      status,
      ...extra,
    });
    // A malformed event is dropped, not thrown: throwing here could abort a run after funds moved.
    if (!parsed.success) {
      console.error("[cloak] dropped an event that failed its schema");
      return;
    }
    deps.emit(parsed.data);
  };
}

/** SDK progress lines are English prose; only short, plain ones reach the card. */
function stageMessage(raw: string): string | null {
  const text = raw.trim();
  if (text.length === 0 || text.length > 160) return null;
  if (!/^[\p{L}\p{N} .,()'\-:/…%]+$/u.test(text)) return null;
  if (/[A-Za-z0-9]{40,}/.test(text)) return null;
  return text;
}

function fallbackFor(step: RunStep): RunErrorCode {
  return step === "preflight" ? "rpc_unreachable" : "unknown";
}

/** Where the money may be when a run stops, which decides what the message tells the operator. */
type PoolState = "none" | "pool" | "uncertain";

function failureMessage(error: RunError, state: PoolState): string {
  const base = error.message;
  if (
    state !== "pool" ||
    error.code === "keys_mismatch" ||
    error.code === "keys_not_deterministic"
  ) {
    return base;
  }
  // The default text of an unknown outcome already says funds may be in the pool, and a claim
  // that they are would contradict it.
  if (error.code === "outcome_unknown") {
    return `${base} Resume checks the chain before it pays anyone; Recover returns what is left.`;
  }
  return `${base} Funds are in the Cloak pool; the same wallet can resume or recover them.`;
}

const SHIELD_MAY_HAVE_LANDED =
  "The deposit may have landed although the run could not confirm it. Use Recover to look for it in the pool before running again.";

const NOTHING_FOUND =
  "Nothing was found in the pool for this wallet. If the run is more than a day old, look again with a full-history RPC; a swap that did not complete returns its funds here only after it times out.";

/** A step that landed but handed back no signature to cite cannot be put in a proof. */
function cite(receipt: TxReceipt): string {
  if (!isTransactionSignature(receipt.signature)) {
    throw new RunError(
      "outcome_unknown",
      "Cloak completed a step but returned no transaction signature to cite. Check the explorer before running again; funds may have moved.",
    );
  }
  return receipt.signature;
}

/**
 * One private payout run: preflight, keys from the wallet, one shield, one payout per payee, the
 * viewing-key report. The notes never reach this function: the session owns them, which is what
 * lets the leak test assert that nothing secret appears in an event, a log line or the proof.
 *
 * A run that stops after the shield is resumable by design: the keys come from the wallet and the
 * notes are rebuilt from the chain, so `resume` only needs the signatures already finished.
 */
export async function runPrivatePayout(plan: RunPlan, deps: RunnerDeps): Promise<RunOutcome> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const log: RunLog = {
    ...(deps.resume?.shieldSignature ? { shieldSignature: deps.resume.shieldSignature } : {}),
    ...(deps.resume?.shieldUncertain ? { shieldUncertain: true } : {}),
    ...(deps.resume?.commitSignature ? { commitSignature: deps.resume.commitSignature } : {}),
    payoutSignatures: { ...(deps.resume?.payoutSignatures ?? emptyRunLog().payoutSignatures) },
  };
  const snapshot = (): RunLog => ({
    ...(log.shieldSignature ? { shieldSignature: log.shieldSignature } : {}),
    ...(log.shieldUncertain ? { shieldUncertain: true } : {}),
    ...(log.commitSignature ? { commitSignature: log.commitSignature } : {}),
    payoutSignatures: { ...log.payoutSignatures },
  });
  const persist = (): void => deps.onLog?.(snapshot());
  const emit = makeEmitter(deps, plan.runId);
  const throwIfAborted = (): void => {
    if (deps.signal?.aborted) throw new RunError("aborted");
  };

  let step: RunStep = "preflight";
  let currentPayee: number | undefined;
  let session: PayoutSession | null = null;
  let balanceBefore: bigint | undefined;
  let state: PoolState = log.shieldSignature ? "pool" : log.shieldUncertain ? "uncertain" : "none";

  const stage =
    (forStep: RunStep, payeeIndex?: number) =>
    (raw: string): void => {
      const message = stageMessage(raw);
      if (message) {
        emit(forStep, "progress", {
          ...(payeeIndex !== undefined ? { payeeIndex } : {}),
          message,
        });
      }
    };

  /** After a shield failed without a verdict: did the deposit leave the wallet anyway? */
  const shieldMayHaveLanded = async (classified: RunError): Promise<boolean> => {
    if (["wallet_rejected", "aborted", "approval_too_slow"].includes(classified.code)) return false;
    if (classified.code === "outcome_unknown") return true;
    if (balanceBefore === undefined) return false;
    try {
      const after = await deps.sdk.balanceLamports(plan.funder);
      return balanceBefore - after >= plan.shieldLamports;
    } catch {
      return false;
    }
  };

  try {
    emit("preflight", "started");
    // The plan priced a run for one funder; a different wallet would sign for someone else's.
    if (deps.wallet.address !== plan.funder) {
      throw new RunError(
        "wallet_not_allowed",
        "The connected wallet is not the one this run was planned for.",
      );
    }
    // An earlier deposit with no signature to cite may be sitting in the pool: shielding again
    // would put a second one beside it.
    if (log.shieldUncertain && !log.shieldSignature) {
      throw new RunError("outcome_unknown", SHIELD_MAY_HAVE_LANDED);
    }
    const info = await deps.sdk.info();
    const health = await deps.sdk.checkEndpoints();
    if (!health.rpc) throw new RunError("rpc_unreachable");
    if (!health.circuits) throw new RunError("circuits_unreachable");
    if (!health.relay) throw new RunError("relay_unreachable");
    for (const payout of plan.payouts) {
      if (payout.deliver === "ZEC" && !payout.zec && !log.payoutSignatures[payout.index]) {
        throw new RunError("swap_quote_unavailable");
      }
    }
    // The card refuses the programs and mints it knows by name; the chain knows the rest. SOL sent
    // to a mint, a program or a token account cannot be taken back.
    const unpaid = plan.payouts.filter((payout) => !log.payoutSignatures[payout.index]);
    const owners = await Promise.all(unpaid.map((payout) => deps.sdk.accountOwner(payout.address)));
    if (owners.some((owner) => owner !== null && owner !== SYSTEM_PROGRAM_ADDRESS)) {
      throw new RunError(
        "payee_invalid",
        "A payee address belongs to a program, a mint or a token account, not to a wallet. Nothing was spent.",
      );
    }
    if (!log.shieldSignature) {
      balanceBefore = await deps.sdk.balanceLamports(plan.funder);
      if (balanceBefore < plan.requiredBalanceLamports) throw new RunError("insufficient_balance");
    }
    emit("preflight", "done");
    throwIfAborted();

    step = "derive-keys";
    emit(step, "started");
    const seed = await obtainMasterSeed(deps.wallet, {
      verifyDeterminism: deps.expectFingerprint === undefined,
    });
    try {
      session = await deps.sdk.openSession(seed);
    } finally {
      seed.fill(0);
    }
    if (deps.expectFingerprint !== undefined && session.fingerprint !== deps.expectFingerprint) {
      throw new RunError("keys_mismatch");
    }
    deps.onFingerprint?.(session.fingerprint);
    emit(step, "done");
    throwIfAborted();

    step = "shield";
    if (log.shieldSignature) {
      emit(step, "skipped", { signature: log.shieldSignature });
      const owed = plan.payouts
        .filter((payout) => !log.payoutSignatures[payout.index])
        .reduce((sum, payout) => sum + payout.grossLamports, 0n);
      // Scoped to this run's deposit. What is left of it is exactly what the unpaid payouts are
      // owed; less means a payout landed without being recorded, and more can only be foreign.
      const recovered = await session.recoverSpendable({ shieldSignature: log.shieldSignature });
      if (recovered.spendableLamports < owed) throw new RunError("outcome_unknown");
    } else {
      emit(step, "started");
      const receipt = await session.shield(plan.shieldLamports, stage("shield"));
      log.shieldSignature = cite(receipt);
      delete log.shieldUncertain;
      state = "pool";
      persist();
      emit(step, "done", { signature: log.shieldSignature });
    }

    if (deps.commitment) {
      step = "commit";
      throwIfAborted();
      if (log.commitSignature) {
        emit(step, "skipped", { signature: log.commitSignature });
      } else {
        emit(step, "started");
        try {
          const receipt = await session.recordCommitment(deps.commitment.memo, stage(step));
          log.commitSignature = cite(receipt);
          persist();
          emit(step, "done", { signature: log.commitSignature });
        } catch (error) {
          // The deposit has moved and the payouts are the point of the run: a hash that could not
          // be written (a closed wallet prompt, an RPC that dropped it) must not strand them.
          console.warn("[cloak] commitment not recorded:", describeForConsole(error));
          emit(step, "failed", {
            errorCode: classifyError(error).code,
            message: "The hash of the privacy text was not recorded; the payouts go on.",
          });
        }
      }
    }

    step = "payout";
    for (const payout of plan.payouts) {
      throwIfAborted();
      const finished = log.payoutSignatures[payout.index];
      if (finished) {
        emit(step, "skipped", { payeeIndex: payout.index, signature: finished });
        continue;
      }
      currentPayee = payout.index;
      emit(step, "started", { payeeIndex: payout.index });
      let receipt: TxReceipt;
      if (payout.deliver === "SOL") {
        receipt = await session.withdrawSol(
          { recipient: payout.address, grossLamports: payout.grossLamports },
          stage(step, payout.index),
        );
      } else {
        if (!payout.zec) throw new RunError("swap_quote_unavailable");
        receipt = await session.swapToZec(
          {
            recipient: payout.address,
            grossLamports: payout.grossLamports,
            minOutputBaseUnits: payout.zec.minOutBaseUnits,
          },
          stage(step, payout.index),
        );
      }
      const signature = cite(receipt);
      log.payoutSignatures[payout.index] = signature;
      persist();
      emit(step, "done", { payeeIndex: payout.index, signature });
    }
    currentPayee = undefined;
    // One deposit funded exactly the sum of the payouts, so nothing stays behind.
    state = "none";

    step = "report";
    emit(step, "started");
    let csv = "";
    try {
      csv = (await session.complianceCsv({ limit: 250 })).csv;
      emit(step, "done");
    } catch (error) {
      // The transactions are final; losing the CSV must not read as a failed payout.
      console.warn("[cloak] compliance CSV failed:", describeForConsole(error));
      emit(step, "failed", {
        errorCode: "unknown",
        message: "The CSV could not be generated; the transactions above are final.",
      });
    }

    const proof = buildProofPack({
      plan,
      log,
      ...(deps.commitment ? { commitment: deps.commitment } : {}),
      startedAt,
      finishedAt: now().toISOString(),
      sdkVersion: info.sdkVersion,
      programId: info.programId,
    });
    return { proof, csv, fingerprint: session.fingerprint, log: snapshot() };
  } catch (error) {
    let classified = classifyError(error, fallbackFor(step));
    console.error(`[cloak] run stopped at ${step}:`, describeForConsole(error));

    // The SDK sometimes learns that a spend landed after the reply that carried its signature
    // was lost. That signature is public and is the difference between a resume that skips the
    // step and one that tries to repeat it.
    const landed = classified.landedSignature;
    if (landed && step === "shield" && !log.shieldSignature) {
      log.shieldSignature = landed;
      delete log.shieldUncertain;
      state = "pool";
      persist();
      emit("shield", "done", { signature: landed, message: "Landed; Cloak's reply was lost." });
    } else if (
      landed &&
      step === "payout" &&
      currentPayee !== undefined &&
      !log.payoutSignatures[currentPayee]
    ) {
      log.payoutSignatures[currentPayee] = landed;
      persist();
      emit("payout", "done", {
        payeeIndex: currentPayee,
        signature: landed,
        message: "Landed; Cloak's reply was lost.",
      });
      currentPayee = undefined;
    } else if (
      step === "shield" &&
      !log.shieldSignature &&
      (await shieldMayHaveLanded(classified))
    ) {
      log.shieldUncertain = true;
      state = "uncertain";
      persist();
      classified = new RunError("outcome_unknown", SHIELD_MAY_HAVE_LANDED, { cause: error });
    }

    emit(step, "failed", {
      ...(currentPayee !== undefined ? { payeeIndex: currentPayee } : {}),
      errorCode: classified.code,
      message: failureMessage(classified, state),
    });
    throw classified;
  } finally {
    session?.dispose();
  }
}

export type RecoverDeps = Omit<RunnerDeps, "resume" | "onFingerprint" | "onLog"> & {
  runId: string;
  /**
   * The run says funds were shielded. Finding none is then a failure to look into, not a result:
   * a public RPC keeps about a day of history, and an empty answer from it proves nothing.
   */
  expectFunds?: boolean;
};

/**
 * For a run that stopped with funds in the pool and no way to finish it: rebuild the notes from
 * the chain and send everything spendable back to the wallet that funded it. It reveals the link
 * the pool hid for that amount, which is why it is a separate, explicit action.
 */
export async function recoverFunds(
  deps: RecoverDeps,
): Promise<{ spendableLamports: bigint; receipt: TxReceipt | null }> {
  const emit = makeEmitter(deps, deps.runId);
  let session: PayoutSession | null = null;
  try {
    emit("recover", "started");
    const seed = await obtainMasterSeed(deps.wallet, {
      verifyDeterminism: deps.expectFingerprint === undefined,
    });
    try {
      session = await deps.sdk.openSession(seed);
    } finally {
      seed.fill(0);
    }
    if (deps.expectFingerprint !== undefined && session.fingerprint !== deps.expectFingerprint) {
      throw new RunError("keys_mismatch");
    }
    const spendable = await session.recoverSpendable();
    if (spendable.spendableLamports <= 0n) {
      if (deps.expectFunds) throw new RunError("outcome_unknown", NOTHING_FOUND);
      emit("recover", "done", { message: NOTHING_FOUND });
      return { spendableLamports: 0n, receipt: null };
    }
    const receipt = await session.sweepAll(deps.wallet.address, (raw) => {
      const message = stageMessage(raw);
      if (message) emit("recover", "progress", { message });
    });
    if (receipt && !isTransactionSignature(receipt.signature)) {
      throw new RunError(
        "outcome_unknown",
        "Cloak completed the transfer but returned no transaction signature to cite. Check the explorer: the funds should be back in the wallet.",
      );
    }
    emit("recover", "done", receipt ? { signature: receipt.signature } : {});
    return { spendableLamports: spendable.spendableLamports, receipt };
  } catch (error) {
    const classified = classifyError(error);
    console.error("[cloak] recovery stopped:", describeForConsole(error));
    emit("recover", "failed", { errorCode: classified.code, message: classified.message });
    throw classified;
  } finally {
    session?.dispose();
  }
}
