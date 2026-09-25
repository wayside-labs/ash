"use client";

import { CircleDashed, Database, FlaskConical, ScrollText } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/i18n/locale-provider";
import type { Exactness } from "@/lib/metrics/schema";
import { cn } from "@/lib/utils";

/**
 * How well the number above it is known.
 *
 * Provenance rides ink level rather than hue, matching `moneyTone()`: colour is
 * reserved for status, so a figure replayed from logs can never be mistaken for a
 * warning, and an exact counter is simply the brightest thing in its tile.
 */
const CONFIG: Record<
  Exactness,
  { labelKey: string; hintKey: string | null; icon: typeof Database; ink: string }
> = {
  counter: {
    labelKey: "metrics.exactness.counter",
    hintKey: "metrics.exactness.counterHint",
    icon: Database,
    ink: "text-muted-foreground",
  },
  events: {
    labelKey: "metrics.exactness.events",
    hintKey: "metrics.exactness.eventsHint",
    icon: ScrollText,
    ink: "text-muted-foreground",
  },
  demo: {
    labelKey: "metrics.exactness.demo",
    hintKey: null,
    icon: FlaskConical,
    ink: "text-subtle-foreground",
  },
  unavailable: {
    labelKey: "metrics.exactness.unavailable",
    hintKey: "metrics.exactness.unavailableHint",
    icon: CircleDashed,
    ink: "text-faint-foreground",
  },
};

export function ExactnessNote({
  exactness,
  className,
  extra,
}: {
  exactness: Exactness;
  className?: string;
  /** An extra qualifier the caller needs on this particular figure. */
  extra?: string;
}) {
  const { t } = useTranslation();
  const { labelKey, hintKey, icon: Icon, ink } = CONFIG[exactness];
  const label = [t(labelKey), extra].filter(Boolean).join(" · ");

  const body = (
    <span
      className={cn("flex items-center gap-1 text-[11px]", ink, className)}
      data-testid={`exactness-${exactness}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </span>
  );

  if (!hintKey) return body;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="text-left">
          {body}
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{t(hintKey)}</TooltipContent>
    </Tooltip>
  );
}
