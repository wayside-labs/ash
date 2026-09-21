"use client";

import { AlertTriangle, Ban, CheckCircle2, CircleDashed } from "lucide-react";
import { useTranslation } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";

type Status = "good" | "warning" | "serious" | "critical" | "unknown";

const STATUS_CONFIG: Record<
  Status,
  { key: string; icon: typeof CheckCircle2; fill: string; ink: string }
> = {
  good: { key: "ceiling.withinLimit", icon: CheckCircle2, fill: "bg-good", ink: "text-good" },
  warning: { key: "ceiling.above50", icon: AlertTriangle, fill: "bg-warning", ink: "text-warning" },
  serious: { key: "ceiling.above80", icon: AlertTriangle, fill: "bg-serious", ink: "text-serious" },
  critical: { key: "ceiling.limitReached", icon: Ban, fill: "bg-critical", ink: "text-critical" },
  unknown: {
    key: "ceiling.noLimitSet",
    icon: CircleDashed,
    fill: "bg-border-strong",
    ink: "text-faint-foreground",
  },
};

function statusFor(spent: number, policy: number): Status {
  if (policy <= 0) return "unknown";
  const pct = spent / policy;
  if (pct >= 1) return "critical";
  if (pct >= 0.8) return "serious";
  if (pct >= 0.5) return "warning";
  return "good";
}

export interface CeilingMeterProps {
  label: string;
  ceiling?: number | null;
  policy: number;
  spent: number;
  format: (value: number) => string;
  className?: string;
  note?: string;
}

export function CeilingMeter({
  label,
  ceiling,
  policy,
  spent,
  format,
  className,
  note,
}: CeilingMeterProps) {
  const { t } = useTranslation();
  const hasCeiling = typeof ceiling === "number" && ceiling > 0;
  const span = hasCeiling ? Math.max(ceiling, policy) : Math.max(policy, spent, 1);

  const policyPct = span > 0 ? Math.min((policy / span) * 100, 100) : 0;
  const spentPct = span > 0 ? Math.min((spent / span) * 100, 100) : 0;

  const showPolicyBand = hasCeiling && policyPct < 99.5;
  const status = statusFor(spent, policy);
  const { key: statusKey, icon: Icon, fill, ink } = STATUS_CONFIG[status];

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm">{label}</span>
        <span className="num num-col shrink-0 text-xs text-muted-foreground">
          {format(spent)} <span className="text-faint-foreground">/</span> {format(policy)}
        </span>
      </div>

      <div className="surface-sunken relative h-2.5 w-full overflow-hidden rounded-full">
        {showPolicyBand && (
          <>
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-ceiling/25"
              style={{ width: `calc(${policyPct}% - 2px)` }}
            />
            <div
              className="absolute inset-y-0 w-px bg-ceiling"
              style={{ left: `${policyPct}%` }}
              aria-hidden
            />
          </>
        )}
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500",
            fill,
          )}
          style={{ width: `${spentPct}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="flex items-center gap-1 text-muted-foreground">
          <Icon className={cn("h-3 w-3", ink)} aria-hidden />
          {t(statusKey)}
        </span>
        <span className="truncate text-faint-foreground">
          {hasCeiling ? (
            <>
              {t("ceiling.ownerCeilingPrefix")}{" "}
              <span className="num">{format(ceiling as number)}</span>
            </>
          ) : (
            (note ?? t("ceiling.noOnChainCeiling"))
          )}
        </span>
      </div>
    </div>
  );
}

export function CeilingLegend({
  className,
  hasCeiling = true,
}: {
  className?: string;
  hasCeiling?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]", className)}>
      <Key swatch="bg-good" label={t("ceiling.legend.agentSpend")} />
      {hasCeiling ? (
        <>
          <Key swatch="bg-ceiling/25" label={t("ceiling.legend.operatorPolicy")} />
          <Key
            swatch="bg-background border border-border"
            label={t("ceiling.legend.ownerCeiling")}
          />
        </>
      ) : (
        <Key
          swatch="bg-background border border-border"
          label={t("ceiling.legend.dashboardLimit")}
        />
      )}
    </div>
  );
}

function Key({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-muted-foreground">
      <span className={cn("h-2 w-4 rounded-full", swatch)} aria-hidden />
      {label}
    </span>
  );
}
