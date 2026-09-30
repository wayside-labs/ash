"use client";

import { Gauge, Loader2 } from "lucide-react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CeilingLegend, CeilingMeter } from "@/components/viz/ceiling-meter";
import { useTreasury, useWorkflows } from "@/hooks/use-dashboard";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import type { Workflow } from "@/lib/types";
import { formatUsd, formatWindow, mintSymbol } from "@/lib/utils";

export default function LimitsPage() {
  const { t } = useTranslation();
  const { workflows, isLoading } = useWorkflows({ withChain: false });

  if (isLoading) {
    return (
      <div>
        <PageHeader wallet title={t("limits.title")} description={t("limits.descriptionShort")} />
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader wallet title={t("limits.title")} description={t("limits.descriptionLong")} />

      {workflows.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title={t("limits.emptyTitle")}
          description={t("limits.emptyDescription")}
        />
      ) : (
        <div className="space-y-6">
          {workflows.map((workflow) => (
            <WorkflowLimits key={workflow.id} workflow={workflow} />
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowLimits({ workflow }: { workflow: Workflow }) {
  const { t, locale } = useTranslation();
  const treasury = useTreasury(workflow.treasuryAddress);
  const onChain = treasury.data;
  const intl = intlLocale(locale);
  const unlimited = t("common.unlimited");

  return (
    <Card className="surface-raised">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <span>{workflow.icon}</span>
            {workflow.name}
            {workflow.demo && <DemoBadge />}
            {workflow.treasuryAddress ? (
              <Badge variant="success">{t("common.onChain")}</Badge>
            ) : (
              <Badge variant="outline">{t("common.dashboardOnly")}</Badge>
            )}
          </CardTitle>
          <CeilingLegend hasCeiling={Boolean(onChain)} />
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {onChain ? (
          <OnChainLimits view={onChain} intl={intl} unlimited={unlimited} t={t} />
        ) : (
          <>
            {treasury.isLoading && workflow.treasuryAddress && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("limits.readingPolicy")}
              </p>
            )}
            {workflow.agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("limits.noAgentsInWorkflow")}</p>
            ) : (
              workflow.agents.map((agent) => (
                <CeilingMeter
                  key={agent.id}
                  label={`${agent.name}${agent.role ? ` · ${agent.role}` : ""}`}
                  policy={agent.dailyLimitUsd}
                  spent={agent.spentUsd ?? 0}
                  format={(v) => formatUsd(v, intl)}
                  note={t("limits.dashboardLimitOnly")}
                />
              ))
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OnChainLimits({
  view,
  intl,
  unlimited,
  t,
}: {
  view: NonNullable<ReturnType<typeof useTreasury>["data"]>;
  intl: string;
  unlimited: string;
  t: (key: string, params?: Record<string, string | number>) => string;
}) {
  const U64_MAX = "18446744073709551615";
  const toNumber = (raw: string, decimals: number | undefined) =>
    raw === U64_MAX ? Number.POSITIVE_INFINITY : Number(raw) / 10 ** (decimals ?? 0);

  return (
    <div className="space-y-6">
      {view.policies.map((policy) => (
        <section key={policy.address} className="space-y-4">
          <p className="text-xs text-subtle-foreground">
            <span className="uppercase tracking-[0.12em]">{t("limits.policyLabel")}</span>{" "}
            <span className="num text-foreground">{policy.name || t("common.unnamed")}</span>
          </p>

          {policy.limits.map((limit) => {
            const decimals = view.decimals[limit.mint];
            const ceiling = view.mints.find((m) => m.mint === limit.mint);
            const spend = view.sessions
              .flatMap((s) => s.spend)
              .filter((c) => c.mint === limit.mint);

            const symbol = mintSymbol(limit.mint);
            const fmt = (value: number) =>
              Number.isFinite(value)
                ? `${value.toLocaleString(intl, { maximumFractionDigits: decimals ?? 2 })} ${symbol}`
                : unlimited;

            const shortSpent = spend.reduce((sum, c) => sum + toNumber(c.shortSpent, decimals), 0);
            const longSpent = spend.reduce((sum, c) => sum + toNumber(c.longSpent, decimals), 0);
            const lifeSpent = spend.reduce(
              (sum, c) => sum + toNumber(c.lifetimeSpent, decimals),
              0,
            );

            return (
              <div key={limit.mint} className="space-y-4">
                <CeilingMeter
                  label={t("limits.shortWindow", {
                    window: formatWindow(limit.shortWindowSeconds),
                  })}
                  ceiling={ceiling ? toNumber(ceiling.maxShortWindow, decimals) : null}
                  policy={toNumber(limit.shortWindowMax, decimals)}
                  spent={shortSpent}
                  format={fmt}
                />
                <CeilingMeter
                  label={t("limits.longWindow", {
                    window: formatWindow(limit.longWindowSeconds),
                  })}
                  ceiling={ceiling ? toNumber(ceiling.maxLongWindow, decimals) : null}
                  policy={toNumber(limit.longWindowMax, decimals)}
                  spent={longSpent}
                  format={fmt}
                />
                <CeilingMeter
                  label={t("limits.sessionLifetime")}
                  ceiling={ceiling ? toNumber(ceiling.maxLifetime, decimals) : null}
                  policy={toNumber(limit.lifetimeMax, decimals)}
                  spent={lifeSpent}
                  format={fmt}
                />
                <CeilingMeter
                  label={t("limits.perTransaction")}
                  ceiling={ceiling ? toNumber(ceiling.maxPerTx, decimals) : null}
                  policy={toNumber(limit.perTxMax, decimals)}
                  spent={0}
                  format={fmt}
                  note={t("limits.perPaymentCapNote")}
                />
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
