"use client";

import { Gauge, Loader2 } from "lucide-react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CeilingLegend, CeilingMeter } from "@/components/viz/ceiling-meter";
import { useTreasury, useWorkflows } from "@/hooks/use-dashboard";
import type { Workflow } from "@/lib/types";
import { formatUsd, formatWindow, mintSymbol } from "@/lib/utils";

export default function LimitsPage() {
  const { workflows, isLoading } = useWorkflows();

  if (isLoading) {
    return (
      <div>
        <PageHeader title="Limits" description="Limites de gasto por workflow e agente" />
        <div className="flex items-center gap-2 py-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Limits"
        description="Afrouxar só desce: o dono fixa o teto, o operador define a política dentro dele, o agente gasta dentro da política."
      />

      {workflows.length === 0 ? (
        <EmptyState
          icon={Gauge}
          title="Nenhum limite para mostrar"
          description="Crie um workflow com agentes para acompanhar os limites aqui."
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
  const treasury = useTreasury(workflow.treasuryAddress);
  const onChain = treasury.data;

  return (
    <Card className="surface-raised">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <span>{workflow.icon}</span>
            {workflow.name}
            {workflow.demo && <DemoBadge />}
            {workflow.treasuryAddress ? (
              <Badge variant="success">on-chain</Badge>
            ) : (
              <Badge variant="outline">só no dashboard</Badge>
            )}
          </CardTitle>
          <CeilingLegend hasCeiling={Boolean(onChain)} />
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {onChain ? (
          <OnChainLimits view={onChain} />
        ) : (
          <>
            {treasury.isLoading && workflow.treasuryAddress && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Lendo a política na rede…
              </p>
            )}
            {workflow.agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum agente neste workflow.</p>
            ) : (
              workflow.agents.map((agent) => (
                <CeilingMeter
                  key={agent.id}
                  label={`${agent.name}${agent.role ? ` · ${agent.role}` : ""}`}
                  policy={agent.dailyLimitUsd}
                  spent={agent.spentUsd ?? 0}
                  format={formatUsd}
                  note="limite só do dashboard"
                />
              ))
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * The real thing: ceiling from Treasury.mints[].ceiling, policy from
 * Policy.mint_limits[], spend from AgentSession.spend[] — the same three
 * numbers the program compares on every payment.
 */
function OnChainLimits({ view }: { view: NonNullable<ReturnType<typeof useTreasury>["data"]> }) {
  const U64_MAX = "18446744073709551615";
  const toNumber = (raw: string, decimals: number | undefined) =>
    raw === U64_MAX ? Number.POSITIVE_INFINITY : Number(raw) / 10 ** (decimals ?? 0);

  return (
    <div className="space-y-6">
      {view.policies.map((policy) => (
        <section key={policy.address} className="space-y-4">
          <p className="text-xs text-subtle-foreground">
            <span className="uppercase tracking-[0.12em]">política</span>{" "}
            <span className="num text-foreground">{policy.name || "(sem nome)"}</span>
          </p>

          {policy.limits.map((limit) => {
            const decimals = view.decimals[limit.mint];
            const ceiling = view.mints.find((m) => m.mint === limit.mint);
            const spend = view.sessions
              .flatMap((s) => s.spend)
              .filter((c) => c.mint === limit.mint);

            const symbol = mintSymbol(limit.mint);
            // A bare "0,045" is unreadable next to a ceiling of "0,1" — the
            // unit is the whole point when the numbers are this small.
            const fmt = (value: number) =>
              Number.isFinite(value)
                ? `${value.toLocaleString("pt-BR", { maximumFractionDigits: decimals ?? 2 })} ${symbol}`
                : "ilimitado";

            const shortSpent = spend.reduce((sum, c) => sum + toNumber(c.shortSpent, decimals), 0);
            const longSpent = spend.reduce((sum, c) => sum + toNumber(c.longSpent, decimals), 0);
            const lifeSpent = spend.reduce(
              (sum, c) => sum + toNumber(c.lifetimeSpent, decimals),
              0,
            );

            return (
              <div key={limit.mint} className="space-y-4">
                <CeilingMeter
                  label={`Janela curta (${formatWindow(limit.shortWindowSeconds)})`}
                  ceiling={ceiling ? toNumber(ceiling.maxShortWindow, decimals) : null}
                  policy={toNumber(limit.shortWindowMax, decimals)}
                  spent={shortSpent}
                  format={fmt}
                />
                <CeilingMeter
                  label={`Janela longa (${formatWindow(limit.longWindowSeconds)})`}
                  ceiling={ceiling ? toNumber(ceiling.maxLongWindow, decimals) : null}
                  policy={toNumber(limit.longWindowMax, decimals)}
                  spent={longSpent}
                  format={fmt}
                />
                <CeilingMeter
                  label="Vida da sessão"
                  ceiling={ceiling ? toNumber(ceiling.maxLifetime, decimals) : null}
                  policy={toNumber(limit.lifetimeMax, decimals)}
                  spent={lifeSpent}
                  format={fmt}
                />
                <CeilingMeter
                  label="Por transação"
                  ceiling={ceiling ? toNumber(ceiling.maxPerTx, decimals) : null}
                  policy={toNumber(limit.perTxMax, decimals)}
                  spent={0}
                  format={fmt}
                  note="teto por pagamento, não acumula"
                />
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
