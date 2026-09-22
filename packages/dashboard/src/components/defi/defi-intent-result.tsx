"use client";

import type { DeFiIntentProposal, DeFiPreflightCheck } from "@agent-rails/contract/defi-intents";
import { AlertTriangle, CheckCircle2, ShieldAlert, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useTranslation } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";

type Props = {
  proposal: DeFiIntentProposal;
};

function PreflightIcon({ check }: { check: DeFiPreflightCheck }) {
  if (check.ok) return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (check.code === "HIGH_RISK_QUARANTINE" || check.code === "CAPABILITY_GAP") {
    return <AlertTriangle className="h-4 w-4 text-amber-500" />;
  }
  return <XCircle className="h-4 w-4 text-destructive" />;
}

export function DeFiIntentResult({ proposal }: Props) {
  const { t } = useTranslation();
  const { parsed, preflight, phases, ownerChecklist, requiredOwnerSteps, riskCardTemplate } =
    proposal;

  return (
    <div className="space-y-4">
      <Card className="surface-raised">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            {t("defi.result.detected")}
            {parsed.protocol ? (
              <Badge variant="secondary">{parsed.protocol.name}</Badge>
            ) : (
              <Badge variant="outline">{t("defi.result.unknownProtocol")}</Badge>
            )}
            {parsed.kind && <Badge variant="outline">{parsed.kind}</Badge>}
            {!proposal.autonomousExecutionAllowed && (
              <Badge variant="destructive" className="gap-1">
                <ShieldAlert className="h-3 w-3" />
                {t("defi.result.autonomousBlocked")}
              </Badge>
            )}
            {proposal.quarantineRecommended && (
              <Badge variant="warning">{t("defi.result.quarantine")}</Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <dl className="grid gap-2 sm:grid-cols-2">
            {parsed.assetSymbol && (
              <div>
                <dt className="text-muted-foreground">{t("defi.result.asset")}</dt>
                <dd className="font-medium">{parsed.assetSymbol}</dd>
              </div>
            )}
            {parsed.amountHint && (
              <div>
                <dt className="text-muted-foreground">{t("defi.result.amountHint")}</dt>
                <dd className="font-medium">{parsed.amountHint}</dd>
              </div>
            )}
            {parsed.apyThresholdPct !== null && (
              <div>
                <dt className="text-muted-foreground">{t("defi.result.apyThreshold")}</dt>
                <dd className="font-medium">{parsed.apyThresholdPct}%</dd>
              </div>
            )}
          </dl>

          {parsed.blockedPatterns.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="mb-2 font-medium text-destructive">
                {t("defi.result.blockedPatterns")}
              </p>
              <ul className="list-inside list-disc space-y-1 text-muted-foreground">
                {parsed.blockedPatterns.map((b) => (
                  <li key={`${b.code}-${b.matched}`}>
                    <span className="font-mono text-xs">{b.code}</span> — {b.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="surface-raised">
        <CardHeader>
          <CardTitle className="text-base">{t("defi.result.pipeline")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol className="flex flex-wrap gap-2">
            {phases.map((phase, index) => (
              <li key={phase} className="flex items-center gap-2 text-sm">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-elevated text-xs font-medium">
                  {index + 1}
                </span>
                <span className="capitalize">{phase}</span>
                {index < phases.length - 1 && (
                  <span className="text-muted-foreground" aria-hidden>
                    →
                  </span>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      <Card className="surface-raised">
        <CardHeader>
          <CardTitle className="text-base">{t("defi.result.preflight")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {preflight.map((check) => (
              <li
                key={`${check.code ?? "ok"}-${check.detail}`}
                className={cn(
                  "flex gap-2 rounded-md border p-2 text-sm",
                  check.ok ? "border-border" : "border-amber-500/30 bg-amber-500/5",
                )}
              >
                <PreflightIcon check={check} />
                <span>
                  {check.code && (
                    <span className="mr-2 font-mono text-xs text-muted-foreground">
                      {check.code}
                    </span>
                  )}
                  {check.detail}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="surface-raised">
          <CardHeader>
            <CardTitle className="text-base">{t("defi.result.ownerChecklist")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
              {ownerChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card className="surface-raised">
          <CardHeader>
            <CardTitle className="text-base">{t("defi.result.requiredSteps")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="list-inside list-decimal space-y-1 text-sm text-muted-foreground">
              {requiredOwnerSteps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="surface-raised">
        <CardHeader>
          <CardTitle className="text-base">{t("defi.result.riskCard")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            {Object.entries(riskCardTemplate).map(([key, value]) => (
              <div key={key}>
                <dt className="font-mono text-xs text-muted-foreground">{key}</dt>
                <dd className="font-medium">
                  {Array.isArray(value) ? value.join(", ") : String(value ?? "—")}
                </dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
