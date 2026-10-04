"use client";

import { formatZec } from "@agent-rails/cloak";
import {
  type CloakPayoutProposal,
  formatLamportsAsSol,
  mainnetExplorerTxUrl,
  type TemplateRunProposal,
} from "@agent-rails/contract/template-run";
import {
  AlertTriangle,
  Check,
  Circle,
  Download,
  ExternalLink,
  Loader2,
  Minus,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useCloakRun } from "@/hooks/use-template-run";
import { useTranslation } from "@/i18n/locale-provider";
import {
  buildTimeline,
  fundsAreInPool,
  type TimelineRow,
} from "@/lib/templates/runners/cloak-timeline";

/** A download link for text the page built itself; revoked when the text goes away. */
function useObjectUrl(content: string | null, type: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!content) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(new Blob([content], { type }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [content, type]);
  return url;
}

/**
 * The whole address, evenly. Emphasising the first and last characters would teach the eye to
 * check only those, which is exactly what address-poisoning look-alikes are ground against.
 */
function Address({ value }: { value: string }) {
  return (
    <span className="num break-all" data-testid="template-run-address">
      {value}
    </span>
  );
}

function StepIcon({ status }: { status: TimelineRow["status"] }) {
  if (status === "started") return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
  if (status === "done") return <Check className="h-3.5 w-3.5 text-good" />;
  if (status === "failed") return <AlertTriangle className="h-3.5 w-3.5 text-critical" />;
  if (status === "skipped") return <Minus className="h-3.5 w-3.5 text-faint-foreground" />;
  return <Circle className="h-3.5 w-3.5 text-faint-foreground" />;
}

/**
 * A private payout the chat proposed. The model cannot run anything: this card is the operator's
 * decision point, the run is theirs, and their wallet signs every step. It states what is real
 * about it up front: mainnet, real funds, the whole address of every payee.
 */
export function TemplateRunCard({ proposal }: { proposal: TemplateRunProposal }) {
  const { t } = useTranslation();
  if (!proposal.ok) {
    return (
      <div
        data-testid="template-run-invalid"
        className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs"
      >
        <p className="flex items-center gap-1.5 font-medium">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
          {t("chat.templateRun.invalid")}
        </p>
        <p className="mt-1 break-words text-muted-foreground">{proposal.error}</p>
      </div>
    );
  }
  return <PayoutCard proposal={proposal.proposal} />;
}

function PayoutCard({ proposal }: { proposal: CloakPayoutProposal }) {
  const { t } = useTranslation();
  const run = useCloakRun(proposal);
  const [addressesChecked, setAddressesChecked] = useState(false);
  const [mainnetUnderstood, setMainnetUnderstood] = useState(false);

  const rows = useMemo(() => buildTimeline(run.plan, run.events), [run.plan, run.events]);
  const proofJson = run.outcome ? `${JSON.stringify(run.outcome.proof, null, 2)}\n` : null;
  const proofUrl = useObjectUrl(proofJson, "application/json");
  const csvUrl = useObjectUrl(run.outcome?.csv || null, "text/csv");

  const running = run.phase === "running";
  const busy = running || run.recovering;
  const inPool = fundsAreInPool(run.events) || run.resumeAvailable || run.uncertain;
  const showRecover =
    inPool && !busy && run.phase !== "done" && !run.recovered && !run.nothingFound;
  const canApprove =
    run.policy.ok &&
    addressesChecked &&
    mainnetUnderstood &&
    !busy &&
    !run.uncertain &&
    run.phase !== "done" &&
    run.quoteState !== "loading" &&
    run.quoteState !== "failed" &&
    run.plan.warnings.length === 0;

  const sol = (lamports: bigint) => formatLamportsAsSol(lamports);

  return (
    <div
      data-testid="template-run"
      className="mt-2 space-y-3 rounded-lg border border-border bg-background/60 p-3 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-primary" />
        <span className="font-medium">{t("chat.templateRun.title")}</span>
        <Badge variant="destructive" data-testid="template-run-mainnet">
          {t("chat.templateRun.mainnet")}
        </Badge>
        {run.testMode && (
          <Badge variant="outline" data-testid="template-run-test-mode">
            {t("chat.templateRun.testMode")}
          </Badge>
        )}
      </div>
      <p className="text-muted-foreground">{t("chat.templateRun.draft")}</p>
      <p className="text-muted-foreground" data-testid="template-run-commit-note">
        {t("chat.templateRun.commitNote")}
      </p>
      {run.funder && (
        <p className="text-muted-foreground" data-testid="template-run-funder">
          <Address value={run.funder} />
        </p>
      )}

      <ul className="space-y-2">
        {run.plan.payouts.map((payout) => (
          <li
            key={payout.index}
            data-testid={`template-run-payee-${payout.index}`}
            className="space-y-1 rounded-md border border-border p-2"
          >
            <div className="flex items-center gap-2">
              <span className="font-medium">{payout.label}</span>
              <Badge variant="outline">{payout.deliver}</Badge>
            </div>
            <div className="text-muted-foreground">
              <Address value={payout.address} />
            </div>
            <div className="text-muted-foreground">
              {payout.deliver === "SOL"
                ? t("chat.templateRun.sol", {
                    gross: sol(payout.grossLamports),
                    fee: sol(payout.feeLamports),
                    net: sol(payout.netLamports),
                  })
                : payout.zec
                  ? t("chat.templateRun.zec", {
                      net: sol(payout.netLamports),
                      fee: sol(payout.feeLamports),
                      min: formatZec(payout.zec.minOutBaseUnits),
                      quote: formatZec(payout.zec.quoteOutBaseUnits),
                    })
                  : t("chat.templateRun.zecNoQuote", {
                      net: sol(payout.netLamports),
                      fee: sol(payout.feeLamports),
                    })}
            </div>
          </li>
        ))}
      </ul>

      <p data-testid="template-run-totals" className="text-muted-foreground">
        {t("chat.templateRun.totals", {
          shield: sol(run.plan.shieldLamports),
          fees: sol(run.plan.totalFeeLamports),
          required: sol(run.plan.requiredBalanceLamports),
        })}
      </p>

      {run.quoteState === "loading" && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("chat.templateRun.quoteLoading")}
        </p>
      )}
      {run.quoteState === "failed" && (
        <p className="flex flex-wrap items-center gap-2 text-warning">
          {t("chat.templateRun.quoteFailed")}
          <Button size="sm" variant="outline" onClick={run.refreshQuote}>
            {t("chat.templateRun.quoteRefresh")}
          </Button>
        </p>
      )}

      {!run.policy.ok && (
        <p
          data-testid="template-run-policy"
          className="flex items-center gap-1.5 rounded-md border border-warning/40 bg-warning/10 p-2 text-warning"
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t(`chat.templateRun.error.${run.policy.code}`)}
        </p>
      )}

      {run.phase !== "done" && (
        <div className="space-y-1.5">
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={addressesChecked}
              disabled={busy}
              onChange={(event) => setAddressesChecked(event.target.checked)}
            />
            <span>{t("chat.templateRun.confirmAddresses")}</span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={mainnetUnderstood}
              disabled={busy}
              onChange={(event) => setMainnetUnderstood(event.target.checked)}
            />
            <span>{t("chat.templateRun.confirmMainnet")}</span>
          </label>
        </div>
      )}

      {run.phase !== "done" && (
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button size="sm" variant="outline" onClick={run.stop}>
              {t("chat.templateRun.stop")}
            </Button>
          ) : (
            <Button
              size="sm"
              data-testid="template-run-approve"
              disabled={!canApprove}
              onClick={() => void run.start()}
            >
              {run.resumeAvailable ? t("chat.templateRun.resume") : t("chat.templateRun.approve")}
            </Button>
          )}
          {running && (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              {t("chat.templateRun.running")}
            </span>
          )}
        </div>
      )}

      {rows.some((row) => row.status !== "pending") && (
        <ol data-testid="template-run-timeline" className="space-y-1">
          {rows.map((row) => (
            <li
              key={row.id}
              data-testid={`template-run-step-${row.id}`}
              data-status={row.status}
              className="space-y-0.5"
            >
              <div className="flex items-center gap-2">
                <StepIcon status={row.status} />
                <span className={row.status === "pending" ? "text-faint-foreground" : undefined}>
                  {t(`chat.templateRun.step.${row.step}`, { n: (row.payeeIndex ?? 0) + 1 })}
                </span>
                {row.signature && (
                  <a
                    href={mainnetExplorerTxUrl(row.signature)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="num inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {row.signature.slice(0, 8)}…{row.signature.slice(-6)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {row.message && (
                <p className="pl-5 text-[11px] text-muted-foreground">{row.message}</p>
              )}
            </li>
          ))}
        </ol>
      )}

      {run.failure && (
        <div
          data-testid="template-run-failure"
          className="space-y-2 rounded-md border border-critical/40 bg-critical/10 p-2"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-critical" />
            {t(`chat.templateRun.error.${run.failure}`)}
          </p>
          {inPool && (
            <p className="text-muted-foreground">
              {run.uncertain
                ? t("chat.templateRun.uncertainFound")
                : t("chat.templateRun.fundsInPool")}
            </p>
          )}
        </div>
      )}
      {showRecover && (
        <div data-testid="template-run-recover-panel" className="space-y-2">
          {!run.failure && (
            <p className="text-muted-foreground">
              {run.uncertain
                ? t("chat.templateRun.uncertainFound")
                : t("chat.templateRun.resumeFound")}
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            data-testid="template-run-recover"
            onClick={() => void run.recover()}
          >
            {t("chat.templateRun.recover")}
          </Button>
        </div>
      )}
      {run.recovering && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("chat.templateRun.recovering")}
        </p>
      )}
      {run.recovered && (
        <p data-testid="template-run-recovered" className="text-good">
          {t("chat.templateRun.recovered")}
        </p>
      )}
      {run.nothingFound && (
        <p data-testid="template-run-nothing-found" className="text-warning">
          {t("chat.templateRun.recoverEmpty")}
        </p>
      )}

      {run.phase === "done" && (
        <div data-testid="template-run-done" className="space-y-2">
          <p className="flex items-center gap-1.5 font-medium text-good">
            <Check className="h-3.5 w-3.5" />
            {t("chat.templateRun.done")}
          </p>
          <div className="flex flex-wrap gap-2">
            {proofUrl && (
              <Button asChild size="sm" variant="outline">
                <a href={proofUrl} download={`agent-rails-cloak-proof-${run.plan.runId}.json`}>
                  <Download className="h-3.5 w-3.5" />
                  {t("chat.templateRun.downloadProof")}
                </a>
              </Button>
            )}
            {csvUrl && (
              <Button asChild size="sm" variant="outline">
                <a href={csvUrl} download={`agent-rails-cloak-${run.plan.runId}.csv`}>
                  <Download className="h-3.5 w-3.5" />
                  {t("chat.templateRun.downloadCsv")}
                </a>
              </Button>
            )}
          </div>
        </div>
      )}

      <p className="text-[11px] text-faint-foreground">{t("chat.templateRun.fineprint")}</p>
    </div>
  );
}
