"use client";

import { AlertTriangle, Ban, CheckCircle2, CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The three bounds the protocol actually enforces, drawn as one bar:
 *
 *   ├──────────────── teto do dono ────────────────┤
 *   ├──── política do operador ────┤
 *   ├── gasto ──┤
 *
 * The bar's full width is the ceiling. The tinted span is the policy — what the
 * operator was allowed to set inside it. The filled span is what the agent has
 * actually spent. Because loosening only ever flows downhill, the policy can
 * never exceed the ceiling and the fill can never exceed the policy; if the data
 * ever says otherwise, that is a bug worth seeing, so it is drawn, not clamped.
 */

type Status = "good" | "warning" | "serious" | "critical" | "unknown";

const STATUS: Record<
  Status,
  { label: string; icon: typeof CheckCircle2; fill: string; ink: string }
> = {
  good: { label: "dentro do limite", icon: CheckCircle2, fill: "bg-good", ink: "text-good" },
  warning: { label: "acima de 50%", icon: AlertTriangle, fill: "bg-warning", ink: "text-warning" },
  serious: { label: "acima de 80%", icon: AlertTriangle, fill: "bg-serious", ink: "text-serious" },
  critical: { label: "limite atingido", icon: Ban, fill: "bg-critical", ink: "text-critical" },
  unknown: {
    label: "sem limite definido",
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
  /** Owner ceiling. Omit when the row has no on-chain treasury behind it. */
  ceiling?: number | null;
  /** Operator policy — the bound that actually binds the agent. */
  policy: number;
  spent: number;
  /** Renders raw numbers; the caller owns units. */
  format: (value: number) => string;
  className?: string;
  /** Right-hand caption, e.g. the mint or the window. */
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
  const hasCeiling = typeof ceiling === "number" && ceiling > 0;
  // Without a ceiling the policy is the whole bar, so the reader is not shown
  // headroom that was never measured.
  const span = hasCeiling ? Math.max(ceiling, policy) : Math.max(policy, spent, 1);

  const policyPct = span > 0 ? Math.min((policy / span) * 100, 100) : 0;
  const spentPct = span > 0 ? Math.min((spent / span) * 100, 100) : 0;

  const showPolicyBand = hasCeiling && policyPct < 99.5;
  const status = statusFor(spent, policy);
  const { label: statusLabel, icon: Icon, fill, ink } = STATUS[status];

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate text-sm">{label}</span>
        <span className="num num-col shrink-0 text-xs text-muted-foreground">
          {format(spent)} <span className="text-faint-foreground">/</span> {format(policy)}
        </span>
      </div>

      {/* Track = the owner ceiling. Sunken so the fills sit on top of it. */}
      <div className="surface-sunken relative h-2.5 w-full overflow-hidden rounded-full">
        {/*
         * The policy band is drawn only when it is genuinely narrower than the
         * ceiling. Painting it full-width where no ceiling exists would make the
         * tint read as the track and imply a bound that was never set.
         * A 2px surface gap separates it from the ceiling headroom.
         */}
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
        {/* Spend fill: 4px rounded data-end, square at the baseline. */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-500",
            fill,
          )}
          style={{ width: `${spentPct}%` }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 text-[11px]">
        {/* Status never travels as colour alone — icon and words carry it too. */}
        <span className="flex items-center gap-1 text-muted-foreground">
          <Icon className={cn("h-3 w-3", ink)} aria-hidden />
          {statusLabel}
        </span>
        <span className="truncate text-faint-foreground">
          {hasCeiling ? (
            <>
              teto do dono <span className="num">{format(ceiling as number)}</span>
            </>
          ) : (
            (note ?? "sem teto on-chain")
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * The legend for the three bands. One per card, not one per meter — the bands
 * mean the same thing on every row.
 */
export function CeilingLegend({
  className,
  hasCeiling = true,
}: {
  className?: string;
  /** Without an on-chain treasury there is no ceiling band to explain. */
  hasCeiling?: boolean;
}) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]", className)}>
      <Key swatch="bg-good" label="gasto do agente" />
      {hasCeiling ? (
        <>
          <Key swatch="bg-ceiling/25" label="política do operador" />
          <Key swatch="bg-background border border-border" label="teto do dono" />
        </>
      ) : (
        <Key swatch="bg-background border border-border" label="limite do dashboard" />
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
