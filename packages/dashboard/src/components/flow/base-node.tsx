"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function FlowNodeShell({
  selected,
  accentClass,
  icon,
  title,
  subtitle,
  children,
  className,
}: {
  selected?: boolean;
  accentClass?: string;
  icon: ReactNode;
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "surface-card min-w-[220px] max-w-[280px] rounded-xl px-3 py-2.5 transition-shadow",
        selected && "ring-1 ring-primary/50",
        className,
      )}
    >
      <div className="mb-2 flex items-start gap-2.5">
        <div
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted",
            accentClass,
          )}
        >
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium leading-tight">{title}</p>
          {subtitle ? <p className="truncate text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}
