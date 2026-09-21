"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { FundingModeBadge } from "@/components/treasury/funding-mode-badge";
import { isNativeSolMint } from "@/components/treasury/mint-selector";
import { WizardStepper } from "@/components/treasury/wizard-stepper";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useActivateSecurityPolicy } from "@/hooks/use-dashboard";
import { useTranslation } from "@/i18n/locale-provider";
import {
  type AgentSecurityWizardValues,
  agentSecurityWizardSchema,
  fundingStrategyFields,
  fundingStrategySchema,
  guardrailsFields,
  guardrailsSchema,
  parseAllowlist,
  validateAllowlistAddresses,
  WIZARD_DEFAULTS,
} from "@/lib/agent-security-wizard-schema";
import { localDateTimeToUnixSeconds, parseAmountToBaseUnits } from "@/lib/amount";
import type { MintCeilingView, PolicyView } from "@/lib/server/solana";
import { cn, mintSymbol, truncateAddress } from "@/lib/utils";

export type AgentSecurityWizardProps = {
  open: boolean;
  onClose: () => void;
  treasuryAddress: string;
  mints: MintCeilingView[];
  policies: PolicyView[];
  onRequestAddAsset?: () => void;
};

const STEPS = ["funding", "guardrails", "review"] as const;

export function AgentSecurityWizard({
  open,
  onClose,
  treasuryAddress,
  mints,
  policies,
  onRequestAddAsset,
}: AgentSecurityWizardProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const activate = useActivateSecurityPolicy();
  const [step, setStep] = useState(0);
  const primaryPolicy = policies[0];

  const form = useForm<AgentSecurityWizardValues>({
    resolver: zodResolver(agentSecurityWizardSchema),
    defaultValues: WIZARD_DEFAULTS,
    mode: "onChange",
  });

  const { register, watch, setValue, handleSubmit, reset, trigger, formState } = form;
  const values = watch();
  const selectedMint = mints.find((m) => m.mint === values.mint);

  const stepLabels = useMemo(
    () => [
      { id: "funding", label: t("securityWizard.steps.funding") },
      { id: "guardrails", label: t("securityWizard.steps.guardrails") },
      { id: "review", label: t("securityWizard.steps.review") },
    ],
    [t],
  );

  useEffect(() => {
    if (!open) return;
    setStep(0);
    activate.reset();
    const preferred =
      mints.find((m) => m.fundingMode === "isolatedVault" && !isNativeSolMint(m.mint)) ?? mints[0];
    reset({
      ...WIZARD_DEFAULTS,
      mint: preferred?.mint ?? "",
    });
  }, [open, mints, reset, activate.reset]);

  async function goNext() {
    if (step === 0) {
      const parsed = fundingStrategySchema.safeParse(values);
      if (!parsed.success) {
        await trigger([...fundingStrategyFields]);
        return;
      }
    }
    if (step === 1) {
      const parsed = guardrailsSchema.safeParse(values);
      if (!parsed.success) {
        await trigger([...guardrailsFields]);
        return;
      }
      if (!validateAllowlistAddresses(values.allowlist)) {
        form.setError("allowlist", { message: "invalidAllowlist" });
        return;
      }
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function goBack() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function onActivate(values: AgentSecurityWizardValues) {
    if (!primaryPolicy) {
      toast(t("securityWizard.error.noPolicy"), "error");
      return;
    }
    const mintConfig = mints.find((m) => m.mint === values.mint);
    if (!mintConfig) return;

    const perTx = parseAmountToBaseUnits(values.maxPerTransaction, mintConfig.decimals);
    const daily = parseAmountToBaseUnits(values.dailyLimit, mintConfig.decimals);
    if (!perTx || !daily) return;

    const allowanceCap =
      values.fundingMode === "nativeAllowance"
        ? parseAmountToBaseUnits(values.allowanceCap ?? "", mintConfig.decimals)
        : undefined;
    const expiryTs =
      values.fundingMode === "nativeAllowance"
        ? localDateTimeToUnixSeconds(values.expiration ?? "")
        : undefined;

    try {
      const outcome = await activate.mutateAsync({
        treasury: treasuryAddress,
        policy: primaryPolicy.address,
        mint: values.mint,
        fundingMode: values.fundingMode,
        maxPerTransaction: perTx,
        dailyLimit: daily,
        allowlist: parseAllowlist(values.allowlist),
        ...(allowanceCap !== null && allowanceCap !== undefined ? { allowanceCap } : {}),
        ...(expiryTs !== null && expiryTs !== undefined ? { expiryTs } : {}),
      });
      toast(
        outcome.status === "confirmed"
          ? t("securityWizard.toast.activated")
          : t("securityWizard.toast.pending"),
        outcome.status === "confirmed" ? "success" : "error",
      );
      onClose();
    } catch {
      // Inline error from mutation.
    }
  }

  const fundingMode = values.fundingMode;
  const showNativeFields = fundingMode === "nativeAllowance";
  const nativeSolBlocked =
    values.mint && isNativeSolMint(values.mint) && fundingMode === "nativeAllowance";
  const pending = activate.isPending;
  const canActivate = Boolean(primaryPolicy) && mints.length > 0;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !pending && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-accent" />
            {t("securityWizard.title")}
          </DialogTitle>
          <DialogDescription>{t("securityWizard.description")}</DialogDescription>
        </DialogHeader>

        <WizardStepper steps={stepLabels} current={step} className="mb-6 px-1" />

        <form className="space-y-5" onSubmit={handleSubmit(onActivate)}>
          {step === 0 && (
            <section className="space-y-4 rounded-xl border border-border bg-surface-card p-4">
              <div>
                <h3 className="text-sm font-medium text-accent">
                  {t("securityWizard.funding.heading")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("securityWizard.funding.subheading")}
                </p>
              </div>

              {mints.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                  <p>{t("securityWizard.funding.noMints")}</p>
                  {onRequestAddAsset && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={onRequestAddAsset}
                    >
                      {t("addAsset.title")}
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>{t("securityWizard.funding.asset")}</Label>
                  <Select
                    value={values.mint || undefined}
                    onValueChange={(mint) => setValue("mint", mint, { shouldValidate: true })}
                  >
                    <SelectTrigger className="bg-surface-card">
                      <SelectValue placeholder={t("securityWizard.funding.assetPlaceholder")} />
                    </SelectTrigger>
                    <SelectContent className="bg-surface-card">
                      {mints.map((mint) => (
                        <SelectItem key={mint.mint} value={mint.mint}>
                          <span className="flex items-center gap-2">
                            <span className="font-medium">{mintSymbol(mint.mint)}</span>
                            <span className="num text-xs text-muted-foreground">
                              {truncateAddress(mint.mint, 6)}
                            </span>
                            <FundingModeBadge mode={mint.fundingMode} />
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <FundingOptionCard
                  title={t("securityWizard.funding.vaultTitle")}
                  description={t("securityWizard.funding.vaultDescription")}
                  selected={fundingMode === "isolatedVault"}
                  onSelect={() =>
                    setValue("fundingMode", "isolatedVault", { shouldValidate: true })
                  }
                />
                <FundingOptionCard
                  title={t("securityWizard.funding.walletTitle")}
                  description={t("securityWizard.funding.walletDescription")}
                  selected={fundingMode === "nativeAllowance"}
                  onSelect={() =>
                    setValue("fundingMode", "nativeAllowance", { shouldValidate: true })
                  }
                  disabled={Boolean(values.mint && isNativeSolMint(values.mint))}
                />
              </div>

              {nativeSolBlocked && (
                <p className="text-xs text-destructive">{t("nativeAllowance.solVaultOnlyHint")}</p>
              )}

              {showNativeFields && !nativeSolBlocked && (
                <div className="space-y-3 rounded-lg border border-accent/30 bg-accent/5 p-3">
                  <p className="text-xs font-medium text-accent">
                    {t("securityWizard.funding.nativeProgram")}
                  </p>
                  <div className="space-y-2">
                    <Label htmlFor="wizard-cap">
                      {t("nativeAllowance.dialog.capLabel", {
                        symbol: selectedMint ? mintSymbol(selectedMint.mint) : "—",
                      })}
                    </Label>
                    <Input
                      id="wizard-cap"
                      inputMode="decimal"
                      placeholder="0.0"
                      {...register("allowanceCap")}
                    />
                    {formState.errors.allowanceCap && (
                      <p className="text-xs text-destructive">
                        {t("nativeAllowance.error.invalidAmount")}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="wizard-expiry">{t("nativeAllowance.dialog.expiryLabel")}</Label>
                    <Input id="wizard-expiry" type="datetime-local" {...register("expiration")} />
                    {formState.errors.expiration && (
                      <p className="text-xs text-destructive">
                        {t("nativeAllowance.error.expiryPast")}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {step === 1 && (
            <section className="space-y-4 rounded-xl border border-border bg-surface-card p-4">
              <div>
                <h3 className="text-sm font-medium text-accent">
                  {t("securityWizard.guardrails.heading")}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("securityWizard.guardrails.subheading")}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="wizard-per-tx">{t("securityWizard.guardrails.perTx")}</Label>
                  <Input
                    id="wizard-per-tx"
                    inputMode="decimal"
                    {...register("maxPerTransaction")}
                  />
                  {formState.errors.maxPerTransaction && (
                    <p className="text-xs text-destructive">
                      {t("securityWizard.error.invalidAmount")}
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="wizard-daily">{t("securityWizard.guardrails.daily")}</Label>
                  <Input id="wizard-daily" inputMode="decimal" {...register("dailyLimit")} />
                  {formState.errors.dailyLimit && (
                    <p className="text-xs text-destructive">
                      {t("securityWizard.error.invalidAmount")}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="wizard-allowlist">{t("securityWizard.guardrails.allowlist")}</Label>
                <Textarea
                  id="wizard-allowlist"
                  rows={4}
                  placeholder={t("securityWizard.guardrails.allowlistPlaceholder")}
                  className="num text-xs"
                  {...register("allowlist")}
                />
                {formState.errors.allowlist && (
                  <p className="text-xs text-destructive">
                    {t("securityWizard.error.invalidAllowlist")}
                  </p>
                )}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="space-y-3 rounded-xl border border-border bg-surface-card p-4">
              <h3 className="text-sm font-medium text-accent">
                {t("securityWizard.review.heading")}
              </h3>
              {!primaryPolicy && (
                <p className="text-xs text-destructive">{t("securityWizard.error.noPolicy")}</p>
              )}
              <ReviewRow
                label={t("securityWizard.review.asset")}
                value={
                  selectedMint
                    ? `${mintSymbol(selectedMint.mint)} · ${truncateAddress(selectedMint.mint, 6)}`
                    : "—"
                }
              />
              <ReviewRow
                label={t("securityWizard.review.funding")}
                value={
                  fundingMode === "nativeAllowance"
                    ? t("securityWizard.funding.walletTitle")
                    : t("securityWizard.funding.vaultTitle")
                }
              />
              {fundingMode === "nativeAllowance" && (
                <>
                  <ReviewRow
                    label={t("securityWizard.review.nativeCap")}
                    value={values.allowanceCap || "—"}
                  />
                  <ReviewRow
                    label={t("securityWizard.review.nativeExpiry")}
                    value={values.expiration ? new Date(values.expiration).toLocaleString() : "—"}
                  />
                </>
              )}
              <ReviewRow
                label={t("securityWizard.review.perTx")}
                value={values.maxPerTransaction}
              />
              <ReviewRow label={t("securityWizard.review.daily")} value={values.dailyLimit} />
              <ReviewRow
                label={t("securityWizard.review.destinations")}
                value={String(parseAllowlist(values.allowlist).length)}
              />
              <p className="rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                {t("securityWizard.review.plainEnglish", {
                  asset: selectedMint ? mintSymbol(selectedMint.mint) : t("common.unnamed"),
                  perTx: values.maxPerTransaction,
                  daily: values.dailyLimit,
                  destinations: String(parseAllowlist(values.allowlist).length),
                  funding:
                    fundingMode === "nativeAllowance"
                      ? t("securityWizard.review.fundingWallet")
                      : t("securityWizard.review.fundingVault"),
                })}
              </p>
            </section>
          )}

          {activate.error && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              {activate.error.message}
            </div>
          )}

          <div className="flex justify-between gap-2 border-t border-border pt-4">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={step === 0 ? onClose : goBack}
            >
              {step === 0 ? (
                t("common.cancel")
              ) : (
                <>
                  <ArrowLeft className="h-4 w-4" />
                  {t("securityWizard.back")}
                </>
              )}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                onClick={goNext}
                disabled={pending || (mints.length === 0 && step === 0)}
              >
                {t("securityWizard.next")}
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" disabled={pending || !canActivate}>
                {pending && <Loader2 className="h-4 w-4 animate-spin" />}
                {pending ? t("securityWizard.confirming") : t("securityWizard.activate")}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function FundingOptionCard({
  title,
  description,
  selected,
  onSelect,
  disabled,
}: {
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "rounded-lg border p-3 text-left transition-colors",
        selected
          ? "border-accent bg-accent/10 ring-1 ring-accent/40"
          : "border-border bg-elevated/30 hover:border-border-strong",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
    </button>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="num text-right font-medium">{value}</span>
    </div>
  );
}
