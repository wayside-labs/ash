"use client";

import { Info } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/i18n/locale-provider";
import type { MetricsPeriod } from "@/lib/metrics/schema";
import { cn, formatWindow } from "@/lib/utils";

/**
 * The buckets the program itself keeps, labelled with their real duration.
 *
 * A policy may use a 6h short window, so the label is rendered from
 * `shortWindowSeconds` rather than hardcoded — the moment this reads "Last 24
 * hours" for a 6h policy, every number beneath it is wrong and nobody can tell.
 *
 * `Custom` is present and disabled on purpose: an arbitrary range needs the event
 * replay, and a counter cannot answer one. Hiding the control would hide the
 * reason, so it stays visible with the explanation attached.
 */
export function PeriodSelector({
  value,
  onChange,
  shortWindowSeconds,
  longWindowSeconds,
}: {
  value: MetricsPeriod;
  onChange: (next: MetricsPeriod) => void;
  shortWindowSeconds: number | null;
  longWindowSeconds: number | null;
}) {
  const { t } = useTranslation();

  const options: { id: MetricsPeriod; label: string }[] = [
    {
      id: "short-window",
      label: shortWindowSeconds
        ? t("metrics.period.shortWindow", { window: formatWindow(shortWindowSeconds) })
        : t("metrics.period.shortWindowUnknown"),
    },
    {
      id: "long-window",
      label: longWindowSeconds
        ? t("metrics.period.longWindow", { window: formatWindow(longWindowSeconds) })
        : t("metrics.period.longWindowUnknown"),
    },
    { id: "session-life", label: t("metrics.period.sessionLife") },
  ];

  return (
    <fieldset className="flex flex-wrap items-center gap-1 border-0 p-0">
      <legend className="sr-only">{t("metrics.period.label")}</legend>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={cn(
            "rounded-md border px-2.5 py-1 text-xs transition-colors",
            value === option.id
              ? "border-primary/40 bg-primary/12 text-primary"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}

      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className="flex cursor-not-allowed items-center gap-1 rounded-md border border-dashed border-border px-2.5 py-1 text-xs text-faint-foreground"
            data-testid="period-custom-disabled"
          >
            {t("metrics.period.custom")}
            <Info className="h-3 w-3" aria-hidden />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">{t("metrics.period.customDisabled")}</TooltipContent>
      </Tooltip>
    </fieldset>
  );
}
