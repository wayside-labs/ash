"use client";

import { MAX_NAME_LEN } from "@agent-rails/contract/constants";
import { fromBaseUnits, toBaseUnits } from "@agent-rails/contract/units";
import type { KeyPairSigner } from "@solana/kit";
import { AlertTriangle, Check, Circle, ExternalLink, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import {
  buildSessionKeyDelivery,
  type SessionKeyDelivery,
  SessionKeyDeliveryDialog,
} from "@/components/workflows/session-key-delivery-dialog";
import {
  type BootstrapForm,
  type BootstrapProgress,
  type BootstrapStepId,
  useBootstrapPlan,
  useRunBootstrap,
  useVendorPresets,
} from "@/hooks/use-bootstrap";
import { useCreateResource, useSolPrice, useUpdateResource } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import { addressSchema } from "@/lib/schema";
import { CLUSTER_LABELS, explorerUrl, getRpcUrl } from "@/lib/solana";
import type { Workflow } from "@/lib/types";
import { cn, truncateAddress } from "@/lib/utils";
import { generateCreateKey } from "@/lib/wallet/create-key";
import {
  exportKeypairBytes,
  generateSessionKeyPair,
  suggestedKeypairFilename,
} from "@/lib/wallet/session-key";
import { useAppStore } from "@/stores/app-store";

const STEPS = ["network", "limits", "destination", "funding", "review"] as const;
type Step = (typeof STEPS)[number];

/**
 * `init`'s defaults, so a treasury made in the browser and one made in a terminal start
 * from the same numbers: 0.1 SOL a payment, 1 SOL a day, 0.5 SOL in the vault, 0.05 SOL
 * for the agent's fees.
 */
const DEFAULTS = {
  policyName: "default",
  perTx: "0.1",
  daily: "1",
  lifetime: "",
  deposit: "0.5",
  feeBudget: "0.05",
};

const SOL_DECIMALS = 9;

type DestinationMode = "none" | "manual" | "vendor";
type StepState = "pending" | BootstrapProgress["phase"];

function lamports(value: string): bigint | null {
  try {
    return toBaseUnits(value.trim(), SOL_DECIMALS);
  } catch {
    return null;
  }
}

function sol(value: string | bigint): string {
  return fromBaseUnits(BigInt(value), SOL_DECIMALS);
}

function fitsName(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && new TextEncoder().encode(trimmed).length <= MAX_NAME_LEN;
}

/**
 * ADR-021 wave 2A: `agent-rails init`, guided, in the browser. The server builds each
 * stage from the CLI's own `buildStages`; this component collects the answers, holds the
 * two keys that must never leave the tab (the throwaway `create_key` and the optional
 * session key), and walks the wallet through one signature per stage.
 *
 * `workflow.treasuryAddress` set means resume: the same wizard continues a treasury whose
 * setup stopped halfway, and the server decides from the chain which stages are left.
 */
export function BootstrapWizard({
  workflow,
  onClose,
}: {
  workflow: Workflow | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const { cluster, customRpc, walletAddress } = useAppStore();
  const planMutation = useBootstrapPlan();
  const run = useRunBootstrap();
  const updateWorkflow = useUpdateResource("workflows");
  const createAgent = useCreateResource("agents");
  const { data: price } = useSolPrice();

  const [step, setStep] = useState<Step>("network");
  const [policyName, setPolicyName] = useState(DEFAULTS.policyName);
  const [perTx, setPerTx] = useState(DEFAULTS.perTx);
  const [daily, setDaily] = useState(DEFAULTS.daily);
  const [lifetime, setLifetime] = useState(DEFAULTS.lifetime);
  const [destinationMode, setDestinationMode] = useState<DestinationMode>("none");
  const [destinationLabel, setDestinationLabel] = useState("");
  const [destinationOwner, setDestinationOwner] = useState("");
  const [vendor, setVendor] = useState<string | null>(null);
  const [deposit, setDeposit] = useState(DEFAULTS.deposit);
  const [withAgent, setWithAgent] = useState(false);
  const [agentName, setAgentName] = useState("");
  const [feeBudget, setFeeBudget] = useState(DEFAULTS.feeBudget);
  const [progress, setProgress] = useState<Partial<Record<BootstrapStepId, StepState>>>({});
  const [finished, setFinished] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<SessionKeyDelivery | null>(null);

  // Generated once per wizard and reused across retries: the treasury PDA is derived from
  // the create_key and the session PDA from the session key, so a fresh key on retry would
  // plan a second treasury instead of resuming the first.
  const createKey = useRef<KeyPairSigner | null>(null);
  const sessionKey = useRef<KeyPairSigner | null>(null);
  const agentRecorded = useRef(false);

  const vendors = useVendorPresets(destinationMode === "vendor");
  const vendorList = vendors.data?.vendors ?? [];
  const selectedVendor = vendorList.find((v) => v.owner === vendor) ?? null;

  const open = workflow !== null;
  const resuming = Boolean(workflow?.treasuryAddress);
  const busy = run.isPending;

  // A new workflow row means a new wizard: nothing carries over from the last one.
  const workflowId = workflow?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the row alone; the mutations' reset is stable
  useEffect(() => {
    if (!workflowId) return;
    createKey.current = null;
    sessionKey.current = null;
    agentRecorded.current = false;
    setStep("network");
    setProgress({});
    setFinished(null);
    planMutation.reset();
    run.reset();
  }, [workflowId]);

  const perTxLamports = lamports(perTx);
  const dailyLamports = lamports(daily);
  const lifetimeLamports = lifetime.trim() ? lamports(lifetime) : null;
  const depositLamports = lamports(deposit);
  const feeBudgetLamports = lamports(feeBudget);

  const limitsError = (() => {
    if (!fitsName(policyName)) return t("bootstrap.limits.nameInvalid");
    if (perTxLamports === null || dailyLamports === null || perTxLamports <= 0n) {
      return t("bootstrap.limits.amountInvalid");
    }
    if (dailyLamports <= 0n) return t("bootstrap.limits.amountInvalid");
    if (perTxLamports > dailyLamports) return t("bootstrap.limits.perTxAboveDaily");
    if (lifetime.trim() && (lifetimeLamports === null || lifetimeLamports < dailyLamports)) {
      return t("bootstrap.limits.lifetimeBelowDaily");
    }
    return null;
  })();

  const destination: BootstrapForm["destination"] =
    destinationMode === "manual"
      ? { owner: destinationOwner.trim(), label: destinationLabel.trim() }
      : destinationMode === "vendor" && selectedVendor
        ? { owner: selectedVendor.owner, label: selectedVendor.label }
        : null;
  const destinationError = (() => {
    if (destinationMode === "none") return null;
    if (destinationMode === "vendor") {
      return selectedVendor ? null : t("bootstrap.destination.pickVendor");
    }
    if (!fitsName(destinationLabel)) return t("bootstrap.destination.labelInvalid");
    if (!addressSchema.safeParse(destinationOwner.trim()).success) {
      return t("common.invalidAddress");
    }
    return null;
  })();

  const fundingError = (() => {
    if (depositLamports === null) return t("bootstrap.limits.amountInvalid");
    if (withAgent && !fitsName(agentName)) return t("bootstrap.funding.agentNameInvalid");
    if (withAgent && feeBudgetLamports === null) return t("bootstrap.limits.amountInvalid");
    return null;
  })();

  const networkError = !walletAddress
    ? t("bootstrap.error.walletNotConnected")
    : cluster === "mainnet-beta"
      ? t("bootstrap.network.mainnetBlocked")
      : null;

  const stepError: Record<Step, string | null> = {
    network: networkError,
    limits: limitsError,
    destination: destinationError,
    funding: fundingError,
    review: null,
  };

  const form = (): BootstrapForm => ({
    policyName: policyName.trim(),
    perTxLamports: String(perTxLamports ?? 0n),
    dailyLamports: String(dailyLamports ?? 0n),
    lifetimeLamports: lifetimeLamports === null ? null : String(lifetimeLamports),
    destination,
    depositLamports: String(depositLamports ?? 0n),
    session:
      withAgent && sessionKey.current
        ? {
            key: sessionKey.current.address,
            label: agentName.trim(),
            feeBudgetLamports: String(feeBudgetLamports ?? 0n),
          }
        : null,
  });

  const loadPlan = async () => {
    if (!resuming && !createKey.current) createKey.current = await generateCreateKey();
    if (withAgent && !sessionKey.current) sessionKey.current = await generateSessionKeyPair();
    planMutation.mutate({
      form: form(),
      treasury: workflow?.treasuryAddress ?? null,
      createKey: createKey.current?.address ?? null,
    });
  };

  const goTo = (next: Step) => {
    setStep(next);
    if (next === "review") void loadPlan();
  };

  const index = STEPS.indexOf(step);
  const back = () => {
    const previous = STEPS[index - 1];
    if (previous) setStep(previous);
  };
  const next = () => {
    const following = STEPS[index + 1];
    if (following && !stepError[step]) goTo(following);
  };

  const recordAgent = async () => {
    const signer = sessionKey.current;
    const session = planMutation.data?.session;
    if (!withAgent || !signer || !session || agentRecorded.current || !workflow) return;
    agentRecorded.current = true;
    const name = agentName.trim();
    const dailyUsd = price?.usd && dailyLamports ? (Number(dailyLamports) / 1e9) * price.usd : 0;
    await createAgent.mutateAsync({
      name,
      role: "",
      workflowId: workflow.id,
      walletAddress: signer.address,
      sessionAddress: session,
      dailyLimitUsd: Math.round(dailyUsd * 100) / 100,
      paysTo: destination ? [destination.label] : [],
      receivesFrom: workflow.name,
      status: "active",
      demo: false,
      demoBalanceUsd: null,
      demoSpentUsd: null,
    });
    setDelivery(
      buildSessionKeyDelivery({
        agentName: name,
        session,
        sessionKey: signer.address,
        keypairBytes: await exportKeypairBytes(signer),
        keypairFilename: suggestedKeypairFilename(name),
        rpcUrl: getRpcUrl(cluster, customRpc),
      }),
    );
  };

  const sign = () => {
    if (!workflow) return;
    run.mutate(
      {
        form: form(),
        treasury: workflow.treasuryAddress,
        createKey: createKey.current,
        onProgress: ({ stepId, phase }) => setProgress((p) => ({ ...p, [stepId]: phase })),
        // Linked the moment it exists, not at the end: a setup that stops at the policy
        // still leaves the workflow pointing at its treasury, and reopening resumes it.
        onTreasury: async (treasury) => {
          if (workflow.treasuryAddress === treasury) return;
          await updateWorkflow.mutateAsync({ id: workflow.id, treasuryAddress: treasury });
        },
      },
      {
        onSuccess: async ({ treasury }) => {
          setFinished(treasury);
          toast(t("bootstrap.done.toast", { name: workflow.name }));
          try {
            await recordAgent();
          } catch (error) {
            toast(
              error instanceof Error ? error.message : t("common.failedToCreateAgent"),
              "error",
            );
          }
        },
      },
    );
  };

  const plan = planMutation.data;
  const shortOfFunds =
    plan !== undefined && BigInt(plan.walletLamports) < BigInt(plan.requiredLamports);

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => !next && !busy && onClose()}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {t(resuming ? "bootstrap.titleResume" : "bootstrap.title", {
                name: workflow?.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>{t("bootstrap.description")}</DialogDescription>
          </DialogHeader>

          {finished ? (
            <div className="space-y-4 text-sm">
              <div className="flex gap-3 rounded-lg border border-good/40 bg-good/10 p-3">
                <Check className="mt-0.5 size-4 shrink-0 text-good" aria-hidden />
                <div className="min-w-0">
                  <p className="font-medium">{t("bootstrap.done.title")}</p>
                  <p className="num mt-1 break-all text-xs text-muted-foreground">{finished}</p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <Link href="/treasury" onClick={onClose}>
                    {t("bootstrap.done.openTreasury")}
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/limits" onClick={onClose}>
                    {t("bootstrap.done.openLimits")}
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  asChild
                  aria-label={t("treasury.aria.openInExplorer")}
                >
                  <a href={explorerUrl(finished, cluster)} target="_blank" rel="noreferrer">
                    <ExternalLink className="size-4" />
                  </a>
                </Button>
              </div>
              <div className="flex justify-end">
                <Button onClick={onClose}>{t("common.close")}</Button>
              </div>
            </div>
          ) : (
            <>
              <ol className="flex gap-1" aria-label={t("bootstrap.stepsAria")}>
                {STEPS.map((name, i) => (
                  <li
                    key={name}
                    aria-current={name === step ? "step" : undefined}
                    className={cn(
                      "h-1 flex-1 rounded-full",
                      i <= index ? "bg-primary" : "bg-muted",
                    )}
                  />
                ))}
              </ol>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(`bootstrap.${step}.heading`)}
              </p>

              <div className="space-y-4 text-sm">
                {step === "network" && (
                  <>
                    <dl className="grid gap-2">
                      <Row label={t("bootstrap.network.cluster")} value={CLUSTER_LABELS[cluster]} />
                      <Row
                        label={t("bootstrap.network.rpc")}
                        value={getRpcUrl(cluster, customRpc)}
                        mono
                      />
                      <Row
                        label={t("bootstrap.network.wallet")}
                        value={walletAddress ? truncateAddress(walletAddress, 6) : "—"}
                        mono
                      />
                    </dl>
                    <p className="text-xs text-muted-foreground">
                      {t(resuming ? "bootstrap.network.hintResume" : "bootstrap.network.hint")}{" "}
                      <Link href="/settings" className="underline" onClick={onClose}>
                        {t("bootstrap.network.changeInSettings")}
                      </Link>
                    </p>
                  </>
                )}

                {step === "limits" && (
                  <>
                    <Field id="bootstrap-policy-name" label={t("bootstrap.limits.policyName")}>
                      <Input
                        id="bootstrap-policy-name"
                        value={policyName}
                        onChange={(e) => setPolicyName(e.target.value)}
                      />
                    </Field>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <Field id="bootstrap-per-tx" label={t("bootstrap.limits.perTx")}>
                        <Input
                          id="bootstrap-per-tx"
                          inputMode="decimal"
                          value={perTx}
                          onChange={(e) => setPerTx(e.target.value)}
                        />
                      </Field>
                      <Field id="bootstrap-daily" label={t("bootstrap.limits.daily")}>
                        <Input
                          id="bootstrap-daily"
                          inputMode="decimal"
                          value={daily}
                          onChange={(e) => setDaily(e.target.value)}
                        />
                      </Field>
                      <Field id="bootstrap-lifetime" label={t("bootstrap.limits.lifetime")}>
                        <Input
                          id="bootstrap-lifetime"
                          inputMode="decimal"
                          value={lifetime}
                          placeholder={
                            dailyLamports ? sol(dailyLamports * 30n) : t("bootstrap.limits.auto")
                          }
                          onChange={(e) => setLifetime(e.target.value)}
                        />
                      </Field>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t(resuming ? "bootstrap.limits.hintResume" : "bootstrap.limits.hint")}
                    </p>
                  </>
                )}

                {step === "destination" && (
                  <>
                    <div className="grid grid-cols-3 gap-2" role="radiogroup">
                      {(["none", "manual", "vendor"] as const).map((mode) => (
                        <Button
                          key={mode}
                          type="button"
                          role="radio"
                          aria-checked={destinationMode === mode}
                          variant={destinationMode === mode ? "default" : "outline"}
                          size="sm"
                          onClick={() => setDestinationMode(mode)}
                        >
                          {t(`bootstrap.destination.mode.${mode}`)}
                        </Button>
                      ))}
                    </div>

                    {destinationMode === "none" && (
                      <p className="text-xs text-muted-foreground">
                        {t("bootstrap.destination.noneHint")}
                      </p>
                    )}

                    {destinationMode === "vendor" &&
                      (vendors.isLoading ? (
                        <p className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="size-3.5 animate-spin" />
                          {t("bootstrap.destination.loadingVendors")}
                        </p>
                      ) : vendorList.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {t("bootstrap.destination.vendorsUnavailable")}
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {vendorList.map((preset) => (
                            <button
                              key={preset.owner}
                              type="button"
                              aria-pressed={vendor === preset.owner}
                              onClick={() => setVendor(preset.owner)}
                              className={cn(
                                "w-full rounded-lg border p-3 text-left transition-colors",
                                vendor === preset.owner
                                  ? "border-primary bg-primary/10"
                                  : "border-border hover:border-primary/40",
                              )}
                            >
                              <p className="font-medium">{preset.title}</p>
                              <p className="num text-xs text-muted-foreground">
                                {preset.label} · {truncateAddress(preset.owner, 6)}
                                {preset.mintRef ? ` · ${preset.mintRef}` : ""}
                              </p>
                            </button>
                          ))}
                          {selectedVendor?.mintRef && selectedVendor.mintRef !== "SOL" && (
                            <p className="text-xs text-muted-foreground">
                              {t("bootstrap.destination.vendorMintNote", {
                                mint: selectedVendor.mintRef,
                              })}
                            </p>
                          )}
                        </div>
                      ))}

                    {destinationMode === "manual" && (
                      <div className="grid gap-3">
                        <Field id="bootstrap-dest-label" label={t("bootstrap.destination.label")}>
                          <Input
                            id="bootstrap-dest-label"
                            value={destinationLabel}
                            onChange={(e) => setDestinationLabel(e.target.value)}
                            placeholder={t("bootstrap.destination.labelPlaceholder")}
                          />
                        </Field>
                        <Field id="bootstrap-dest-owner" label={t("bootstrap.destination.owner")}>
                          <Input
                            id="bootstrap-dest-owner"
                            className="num text-sm"
                            value={destinationOwner}
                            onChange={(e) => setDestinationOwner(e.target.value)}
                          />
                        </Field>
                      </div>
                    )}
                  </>
                )}

                {step === "funding" && (
                  <>
                    <Field id="bootstrap-deposit" label={t("bootstrap.funding.deposit")}>
                      <Input
                        id="bootstrap-deposit"
                        inputMode="decimal"
                        value={deposit}
                        onChange={(e) => setDeposit(e.target.value)}
                      />
                    </Field>
                    <p className="text-xs text-muted-foreground">
                      {t("bootstrap.funding.depositHint")}
                    </p>

                    <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <Label htmlFor="bootstrap-with-agent">
                        {t("bootstrap.funding.withAgent")}
                      </Label>
                      <Switch
                        id="bootstrap-with-agent"
                        checked={withAgent}
                        onCheckedChange={(checked) => {
                          setWithAgent(checked);
                          // A key planned for one run is not reused by a different answer.
                          if (!checked) sessionKey.current = null;
                        }}
                      />
                    </div>
                    {withAgent && (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field id="bootstrap-agent-name" label={t("common.name")}>
                          <Input
                            id="bootstrap-agent-name"
                            value={agentName}
                            onChange={(e) => setAgentName(e.target.value)}
                          />
                        </Field>
                        <Field id="bootstrap-fee-budget" label={t("bootstrap.funding.feeBudget")}>
                          <Input
                            id="bootstrap-fee-budget"
                            inputMode="decimal"
                            value={feeBudget}
                            onChange={(e) => setFeeBudget(e.target.value)}
                          />
                        </Field>
                        <p className="text-xs text-muted-foreground sm:col-span-2">
                          {t("bootstrap.funding.agentHint")}
                        </p>
                      </div>
                    )}
                  </>
                )}

                {step === "review" && (
                  <>
                    {planMutation.isPending && (
                      <p className="flex items-center gap-2 text-muted-foreground">
                        <Loader2 className="size-4 animate-spin" />
                        {t("bootstrap.review.reading")}
                      </p>
                    )}
                    {plan && (
                      <>
                        <dl className="grid gap-2">
                          <Row
                            label={t("bootstrap.review.treasury")}
                            value={truncateAddress(plan.treasury, 6)}
                            mono
                          />
                          <Row
                            label={t("bootstrap.review.vault")}
                            value={t("bootstrap.review.vaultValue", {
                              held: sol(plan.deposit.held),
                              target: sol(plan.deposit.target),
                            })}
                          />
                          <Row
                            label={t("bootstrap.review.walletBalance")}
                            value={t("bootstrap.review.balanceValue", {
                              held: sol(plan.walletLamports),
                              required: sol(plan.requiredLamports),
                            })}
                          />
                        </dl>
                        {plan.steps.length === 0 ? (
                          <p className="text-muted-foreground">
                            {t("bootstrap.review.nothingToDo")}
                          </p>
                        ) : (
                          <ol className="space-y-2" data-testid="bootstrap-steps">
                            {plan.steps.map((s) => (
                              <StepRow
                                key={s.id}
                                label={t(`bootstrap.step.${s.id}`)}
                                state={progress[s.id] ?? "pending"}
                              />
                            ))}
                          </ol>
                        )}
                        {shortOfFunds && (
                          <p className="text-xs text-warning">
                            {t("bootstrap.review.shortOfFunds")}{" "}
                            {cluster === "devnet" && (
                              <a
                                href="https://faucet.solana.com"
                                target="_blank"
                                rel="noreferrer"
                                className="underline"
                              >
                                faucet.solana.com
                              </a>
                            )}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {t("bootstrap.review.signHint", { count: plan.steps.length })}
                        </p>
                      </>
                    )}
                  </>
                )}

                {stepError[step] && <p className="text-xs text-destructive">{stepError[step]}</p>}

                {(planMutation.error || run.error) && step === "review" && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-xs"
                  >
                    <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                    <span>{(run.error ?? planMutation.error)?.message}</span>
                  </div>
                )}
              </div>

              <div className="flex justify-between gap-2">
                <Button variant="outline" onClick={index === 0 ? onClose : back} disabled={busy}>
                  {index === 0 ? t("common.cancel") : t("bootstrap.back")}
                </Button>
                {step === "review" ? (
                  plan && plan.steps.length === 0 && !run.error ? (
                    <Button onClick={sign} disabled={busy}>
                      {t("bootstrap.review.link")}
                    </Button>
                  ) : (
                    <Button
                      onClick={plan ? sign : () => void loadPlan()}
                      disabled={busy || planMutation.isPending}
                    >
                      {busy && <Loader2 className="size-4 animate-spin" />}
                      {!plan
                        ? t("bootstrap.review.retryPlan")
                        : run.error
                          ? t("bootstrap.review.retry")
                          : t("bootstrap.review.sign", { count: plan.steps.length })}
                    </Button>
                  )
                ) : (
                  <Button onClick={next} disabled={Boolean(stepError[step])}>
                    {t("bootstrap.next")}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <SessionKeyDeliveryDialog delivery={delivery} onClose={() => setDelivery(null)} />
    </>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 truncate text-right", mono && "num text-xs")}>{value}</dd>
    </div>
  );
}

function StepRow({ label, state }: { label: string; state: StepState }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-2" data-state={state}>
      {state === "confirmed" ? (
        <Check className="size-4 text-good" aria-hidden />
      ) : state === "pending" ? (
        <Circle className="size-4 text-muted-foreground" aria-hidden />
      ) : (
        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />
      )}
      <span className="flex-1">{label}</span>
      <span className="text-xs text-muted-foreground">{t(`bootstrap.phase.${state}`)}</span>
    </li>
  );
}
