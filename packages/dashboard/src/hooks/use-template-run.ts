"use client";

import {
  buildRunPlan,
  COMMITMENT_MEMO,
  checkRunPolicy,
  classifyError,
  emptyRunLog,
  newRunId,
  type PolicyResult,
  quoteDrifted,
  quoteZecPayouts,
  RunError,
  type RunLog,
  type RunOutcome,
  type RunPlan,
  recoverFunds,
  runPrivatePayout,
  type SdkPort,
} from "@ash/cloak";
import type { CloakPayoutProposal, RunErrorCode, RunEvent } from "@ash/contract/template-run";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CloakRunConfig, cloakRunConfig } from "@/lib/templates/runners/cloak-config";
import { withWalletRunLock } from "@/lib/templates/runners/cloak-lock";
import {
  clearRunLog,
  readFingerprint,
  readRunLog,
  runStorageKey,
  writeFingerprint,
  writeRunLog,
} from "@/lib/templates/runners/cloak-storage";
import { standardWalletHandle } from "@/lib/wallet-standard";
import { useAppStore } from "@/stores/app-store";

export type QuoteState = "none" | "loading" | "ready" | "failed";
export type RunPhase = "idle" | "running" | "done" | "failed";

export type CloakRunView = {
  /** The connected wallet, or "" before one is connected. */
  funder: string;
  plan: RunPlan;
  policy: PolicyResult;
  quoteState: QuoteState;
  refreshQuote: () => void;
  phase: RunPhase;
  events: RunEvent[];
  outcome: RunOutcome | null;
  failure: RunErrorCode | null;
  /** An earlier attempt shielded and stopped: running again resumes it. */
  resumeAvailable: boolean;
  /** A deposit may have landed with no signature to cite: only a recovery can look, so a new run waits. */
  uncertain: boolean;
  recovering: boolean;
  /** A recovery sent what it found back to the wallet. */
  recovered: boolean;
  /** A recovery looked and found nothing, which is not the same as nothing being there. */
  nothingFound: boolean;
  /** The build swaps Cloak for a stand-in: nothing this card does is real. */
  testMode: boolean;
  start: () => Promise<void>;
  stop: () => void;
  recover: () => Promise<void>;
};

type WalletHandle = ReturnType<typeof standardWalletHandle>;

/**
 * The SDK loads only here, when someone presses Run: the proof system is large and nothing on a
 * page that merely shows the card needs it. The UI suite swaps in a stand-in through a build-time
 * flag, since there is no relay, no circuit download and no mainnet in a browser test.
 */
async function openSdk(config: CloakRunConfig, wallet: WalletHandle): Promise<SdkPort> {
  if (config.fakeSdk) {
    // Test-only branch: one stand-in per page, so a recovery sees the pool a failed run left, and
    // a spec can inject failures before the page loads. Never reached unless the build set the flag.
    const { createFakeSdk } = await import("@ash/cloak/testing");
    const page = globalThis as unknown as {
      __CLOAK_FAKE_OPTIONS__?: Parameters<typeof createFakeSdk>[0];
      __CLOAK_FAKE_SDK__?: SdkPort;
    };
    page.__CLOAK_FAKE_SDK__ ??= createFakeSdk(page.__CLOAK_FAKE_OPTIONS__);
    return page.__CLOAK_FAKE_SDK__;
  }
  const { createCloakSdkPort } = await import("@ash/cloak/adapter");
  return createCloakSdkPort({ rpcUrl: config.rpcUrl, auth: { kind: "wallet", wallet } });
}

/**
 * A streamed reply is parsed again on every chunk, so the proposal in it is a new object each
 * time even when nothing in it changed. Everything keyed on its identity (the quote, the plan)
 * would run again per chunk; this keeps the first object for as long as the content is the same.
 */
function useStableProposal(proposal: CloakPayoutProposal): CloakPayoutProposal {
  const key = JSON.stringify(proposal);
  const held = useRef({ key, proposal });
  if (held.current.key !== key) held.current = { key, proposal };
  return held.current.proposal;
}

/**
 * Everything the payout card does, apart from drawing it: the plan and its quote, the policy gate,
 * and the run with its resume, stop and recover. The model never reaches this; a person pressing
 * a button in the card does, and then the wallet asks for each signature.
 */
export function useCloakRun(proposalInput: CloakPayoutProposal): CloakRunView {
  const proposal = useStableProposal(proposalInput);
  const walletAddress = useAppStore((state) => state.walletAddress);
  const walletName = useAppStore((state) => state.walletName);
  const config = useMemo(() => cloakRunConfig(), []);
  const [runId] = useState(() => newRunId());
  const funder = walletAddress ?? "";
  const needsQuote = proposal.payees.some((payee) => payee.deliver === "ZEC");

  const [quotes, setQuotes] = useState<ReadonlyMap<number, bigint>>(() => new Map());
  const [quoteState, setQuoteState] = useState<QuoteState>(needsQuote ? "loading" : "none");
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [failure, setFailure] = useState<RunErrorCode | null>(null);
  const [stored, setStored] = useState<RunLog | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [nothingFound, setNothingFound] = useState(false);
  const busy = useRef(false);
  const abort = useRef<AbortController | null>(null);

  const storageKey = useMemo(() => runStorageKey(funder, proposal), [funder, proposal]);
  const resumeAvailable = Boolean(stored?.shieldSignature);
  const uncertain = Boolean(stored?.shieldUncertain) && !stored?.shieldSignature;

  const plan = useMemo(
    () => buildRunPlan(proposal, { runId, funder, zecQuotes: quotes }),
    [proposal, runId, funder, quotes],
  );
  const policy = useMemo(
    () =>
      checkRunPolicy(proposal, {
        funder: walletAddress,
        mainnetEnabled: config.mainnetEnabled,
        allowedWallets: config.allowedWallets,
        contacts: config.contacts,
      }),
    [proposal, walletAddress, config],
  );

  const refreshQuote = useCallback(() => {
    if (!needsQuote) return;
    setQuoteState("loading");
    const unquoted = buildRunPlan(proposal, { runId, funder });
    quoteZecPayouts(unquoted.payouts).then(
      (fresh) => {
        setQuotes(fresh);
        setQuoteState("ready");
      },
      () => setQuoteState("failed"),
    );
  }, [needsQuote, proposal, runId, funder]);

  useEffect(refreshQuote, [refreshQuote]);

  useEffect(() => {
    setStored(readRunLog(storageKey));
  }, [storageKey]);

  // A run is minutes of signatures with funds in the pool. Leaving the page ends it at an
  // unknown step, so the browser is asked first. (A card that unmounts does not stop the run: it
  // would only strand the funds a step earlier. The log still lets it be resumed or recovered.)
  const active = phase === "running" || recovering;
  useEffect(() => {
    if (!active) return;
    const guard = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [active]);

  const start = useCallback(async () => {
    if (busy.current || !policy.ok || !walletAddress) return;
    busy.current = true;
    const controller = new AbortController();
    abort.current = controller;
    setPhase("running");
    setFailure(null);
    setEvents([]);
    setOutcome(null);
    setRecovered(false);
    setNothingFound(false);
    try {
      const run = await withWalletRunLock(walletAddress, async () => {
        const log: RunLog = readRunLog(storageKey) ?? emptyRunLog();
        // The quote bounds the swap, so it is fetched again at the moment of approval. If it
        // moved enough to change the floor the operator read, they read the new one first.
        let finalPlan = plan;
        const unpaidZec = plan.payouts
          .filter((payout) => payout.deliver === "ZEC" && !log.payoutSignatures[payout.index])
          .map((payout) => payout.index);
        if (unpaidZec.length > 0) {
          const fresh = await quoteZecPayouts(buildRunPlan(proposal, { runId, funder }).payouts, {
            signal: controller.signal,
          });
          setQuotes(fresh);
          setQuoteState("ready");
          if (quoteDrifted(quotes, fresh, unpaidZec)) throw new RunError("quote_moved");
          finalPlan = buildRunPlan(proposal, { runId, funder, zecQuotes: fresh });
        }
        const wallet = standardWalletHandle({ address: walletAddress, walletName });
        const sdk = await openSdk(config, wallet);
        const fingerprint = readFingerprint(walletAddress);
        return runPrivatePayout(finalPlan, {
          sdk,
          wallet,
          signal: controller.signal,
          emit: (event) => setEvents((previous) => [...previous, event]),
          // The runner's own log, written as it changes: what a resume trusts never depends on
          // an event having reached the card.
          // The template also writes a hash of its privacy text on-chain, in a transaction of its
          // own right after the deposit (proof of existence). It never stops a payout.
          commitment: { memo: COMMITMENT_MEMO },
          onLog: (next) => writeRunLog(storageKey, next),
          onFingerprint: (value) => writeFingerprint(walletAddress, value),
          ...(fingerprint ? { expectFingerprint: fingerprint } : {}),
          ...(log.shieldSignature || log.shieldUncertain ? { resume: log } : {}),
        });
      });
      if (!run.held) throw new RunError("run_in_progress");
      // A finished payout is not resumable: asking for the same one again is a new payout.
      clearRunLog(storageKey);
      setStored(null);
      setOutcome(run.value);
      setPhase("done");
    } catch (error) {
      setFailure(classifyError(error).code);
      setPhase("failed");
      setStored(readRunLog(storageKey));
    } finally {
      busy.current = false;
      abort.current = null;
    }
  }, [
    policy,
    walletAddress,
    walletName,
    storageKey,
    plan,
    quotes,
    proposal,
    runId,
    funder,
    config,
  ]);

  const stop = useCallback(() => abort.current?.abort(), []);

  const recover = useCallback(async () => {
    if (busy.current || !walletAddress) return;
    busy.current = true;
    setRecovering(true);
    setFailure(null);
    setNothingFound(false);
    try {
      const result = await withWalletRunLock(walletAddress, async () => {
        const wallet = standardWalletHandle({ address: walletAddress, walletName });
        const sdk = await openSdk(config, wallet);
        const fingerprint = readFingerprint(walletAddress);
        return recoverFunds({
          sdk,
          wallet,
          runId,
          emit: (event) => setEvents((previous) => [...previous, event]),
          // A log that names a deposit says funds should be there, so finding none is a stop to
          // look into and not a recovery. The log stays until money is confirmed back.
          ...(readRunLog(storageKey)?.shieldSignature ? { expectFunds: true } : {}),
          ...(fingerprint ? { expectFingerprint: fingerprint } : {}),
        });
      });
      if (!result.held) throw new RunError("run_in_progress");
      clearRunLog(storageKey);
      setStored(null);
      if (result.value.receipt) setRecovered(true);
      else setNothingFound(true);
    } catch (error) {
      setFailure(classifyError(error).code);
    } finally {
      busy.current = false;
      setRecovering(false);
    }
  }, [walletAddress, walletName, config, runId, storageKey]);

  return {
    funder,
    plan,
    policy,
    quoteState,
    refreshQuote,
    phase,
    events,
    outcome,
    failure,
    resumeAvailable,
    uncertain,
    recovering,
    recovered,
    nothingFound,
    testMode: config.fakeSdk,
    start,
    stop,
    recover,
  };
}
