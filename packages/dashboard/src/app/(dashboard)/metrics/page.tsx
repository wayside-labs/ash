"use client";

import { ChartNoAxesColumn, Loader2, RefreshCw } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useMemo } from "react";
import { DestinationList } from "@/components/metrics/destination-list";
import { HeadroomPanel } from "@/components/metrics/headroom-panel";
import { IntegrityPanel } from "@/components/metrics/integrity-panel";
import { KpiRow } from "@/components/metrics/kpi-row";
import { PaymentsTable } from "@/components/metrics/payments-table";
import { PeriodSelector } from "@/components/metrics/period-selector";
import { ScopeSelector } from "@/components/metrics/scope-selector";
import { TokenSplit } from "@/components/metrics/token-split";
import { ValuationCard } from "@/components/metrics/valuation-card";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWorkflows } from "@/hooks/use-dashboard";
import { resolveScope, useDestinationContacts, useMetricsSummary } from "@/hooks/use-metrics";
import { useTranslation } from "@/i18n/locale-provider";
import { MOCK_PAYMENTS } from "@/lib/metrics/mock";
import { type MetricsPeriod, type MetricsScope, metricsPeriodSchema } from "@/lib/metrics/schema";
import { useAppStore } from "@/stores/app-store";

/**
 * The CFO view (docs/product/metrics-page.md).
 *
 * Read-only, and not by omission: there is no write path on this page at all, not
 * even the owner's own withdraw that `/treasury` offers. Everything that loosens a
 * constraint is a CLI verb, so this page reports a nearly-spent limit and hands
 * over the command rather than the control.
 *
 * Scope and period live in the URL rather than in the store: a metrics view is a
 * link somebody sends a colleague, and the back button should walk the drill-down.
 */
export default function MetricsPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useSearchParams();
  const { cluster } = useAppStore();
  const { workflows, isLoading } = useWorkflows();

  const scope: MetricsScope = useMemo(
    () => ({
      workflowId: params.get("workflowId"),
      agentId: params.get("agentId"),
      mint: params.get("mint"),
    }),
    [params],
  );

  const period: MetricsPeriod =
    metricsPeriodSchema.safeParse(params.get("period")).data ?? "short-window";

  const setParams = useCallback(
    (next: Record<string, string | null>) => {
      const search = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(next)) {
        if (value === null) search.delete(key);
        else search.set(key, value);
      }
      const query = search.toString();
      router.replace(query ? `/metrics?${query}` : "/metrics", { scroll: false });
    },
    [params, router],
  );

  const { treasuries, sessions } = useMemo(
    () => resolveScope(workflows, scope),
    [workflows, scope],
  );

  const summaryQuery = useMetricsSummary({ treasuries, sessions, period, scope });
  const summary = summaryQuery.data;

  // The roster belongs to a policy, and Phase A reads the first one in scope.
  // A treasury with several policies is rare enough that guessing would be worse
  // than showing the one the headroom panel already names first.
  const firstPolicy = summary?.policies[0]?.address ?? null;
  const destinations = useDestinationContacts(firstPolicy);

  const mints = useMemo(
    () => [...new Set(workflows.flatMap((w) => w.assets.map((asset) => asset.mint)))],
    [workflows],
  );

  // `destinationMode === 0` is DestinationMode::Any: the policy accepts any
  // destination, so there is no roster and an empty list would read as the
  // opposite of the truth.
  const anyMode =
    summary?.policies.find((policy) => policy.address === firstPolicy)?.destinationMode === 0;

  const decimalsByMint = useMemo(() => {
    const map: Record<string, number> = {};
    for (const row of summary?.headroom ?? []) map[row.mint] = row.decimals;
    return map;
  }, [summary]);

  const onChainWorkflows = workflows.filter((w) => w.treasuryAddress);

  if (isLoading) {
    return (
      <div>
        <PageHeader title={t("metrics.title")} description={t("metrics.description")} />
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t("metrics.title")}
        description={t("metrics.description")}
        action={
          <div className="flex items-center gap-2">
            <Badge variant="outline">{cluster}</Badge>
            <Button
              variant="outline"
              size="icon"
              aria-label={t("metrics.aria.refresh")}
              onClick={() => summaryQuery.refetch()}
              disabled={summaryQuery.isFetching}
            >
              <RefreshCw className={summaryQuery.isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            </Button>
          </div>
        }
      />

      {onChainWorkflows.length === 0 ? (
        <EmptyState
          icon={ChartNoAxesColumn}
          title={t("metrics.emptyTitle")}
          description={t("metrics.emptyDescription")}
        >
          <code className="mt-4 block rounded bg-muted px-2 py-1 text-[11px] text-foreground">
            pnpm agent-rails init --rpc &lt;url&gt;
          </code>
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ScopeSelector
              workflows={onChainWorkflows}
              scope={scope}
              mints={mints}
              onChange={(next) =>
                setParams({
                  workflowId: next.workflowId,
                  agentId: next.agentId,
                  mint: next.mint,
                })
              }
            />
            <PeriodSelector
              value={period}
              onChange={(next) => setParams({ period: next })}
              shortWindowSeconds={
                summary?.headroom.find((row) => row.window === "short")?.windowSeconds ?? null
              }
              longWindowSeconds={
                summary?.headroom.find((row) => row.window === "long")?.windowSeconds ?? null
              }
            />
          </div>

          {summaryQuery.isError && (
            <p className="rounded-lg border border-critical/40 bg-critical/8 px-3 py-2 text-sm text-critical">
              {summaryQuery.error instanceof Error
                ? summaryQuery.error.message
                : t("api.error.metricsReadFailed")}
            </p>
          )}

          {/*
            A treasury that could not be read is named rather than quietly left
            out: a smaller total with no explanation is the failure mode this
            banner exists to prevent.
          */}
          {summary && summary.unreadable.length > 0 && (
            <p className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-sm text-warning">
              {t("api.error.unreadableTreasury", { count: summary.unreadable.length })}
            </p>
          )}

          {summary ? (
            <>
              <KpiRow summary={summary} />
              <HeadroomPanel summary={summary} />
              <div className="grid gap-4 lg:grid-cols-2">
                <TokenSplit summary={summary} />
                <DestinationList
                  contacts={destinations.data?.contacts ?? []}
                  isLoading={destinations.isPending && Boolean(firstPolicy)}
                  anyMode={anyMode}
                  decimalsByMint={decimalsByMint}
                />
              </div>
              <ValuationCard summary={summary} />
              <PaymentsTable payments={MOCK_PAYMENTS} />
              <IntegrityPanel summary={summary} />
            </>
          ) : (
            <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
