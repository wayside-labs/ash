"use client";

import { Handle, type HandleProps, Position } from "@xyflow/react";
import { cn } from "@/lib/utils";

const handleClass =
  "!h-2.5 !w-2.5 !border-2 !border-border-strong !bg-elevated transition-colors hover:!border-primary hover:!bg-primary/20";

export function FlowTargetHandle({
  className,
  position = Position.Left,
  ...props
}: Omit<HandleProps, "type" | "position"> & { position?: Position }) {
  return (
    <Handle type="target" position={position} className={cn(handleClass, className)} {...props} />
  );
}

export function FlowSourceHandle({
  className,
  position = Position.Right,
  ...props
}: Omit<HandleProps, "type" | "position"> & { position?: Position }) {
  return (
    <Handle type="source" position={position} className={cn(handleClass, className)} {...props} />
  );
}
