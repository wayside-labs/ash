"use client";

import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { Exactness } from "@/lib/metrics/schema";
import { cn } from "@/lib/utils";
import { ExactnessNote } from "./exactness-note";

/**
 * One headline number.
 *
 * `value` is already formatted by the caller, because only the caller knows
 * whether it is a token amount, a count or an em dash — and an em dash is a real
 * value here, not a loading state.
 */
export function KpiTile({
  label,
  value,
  secondary,
  exactness,
  exactnessExtra,
  tone,
  children,
  testId,
}: {
  label: string;
  value: string;
  secondary?: ReactNode;
  exactness: Exactness;
  exactnessExtra?: string;
  /** Ink for the headline, so an unavailable figure reads as absent. */
  tone?: string;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <Card data-testid={testId}>
      <CardContent className="space-y-1 p-4 pt-4">
        <p className="text-xs uppercase tracking-[0.12em] text-subtle-foreground">{label}</p>
        <p className={cn("num text-2xl font-bold", tone ?? "text-foreground")}>{value}</p>
        {secondary && <div className="num text-sm text-muted-foreground">{secondary}</div>}
        {children}
        <ExactnessNote
          exactness={exactness}
          {...(exactnessExtra ? { extra: exactnessExtra } : {})}
          className="pt-1"
        />
      </CardContent>
    </Card>
  );
}
