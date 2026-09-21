"use client";

import { GripHorizontal, GripVertical } from "lucide-react";
import type { ComponentProps } from "react";
import { Separator } from "react-resizable-panels";
import { cn } from "@/lib/utils";

export {
  Group as ResizablePanelGroup,
  Panel as ResizablePanel,
  useDefaultLayout,
} from "react-resizable-panels";

export function ResizableHandle({
  className,
  orientation = "horizontal",
  ...props
}: ComponentProps<typeof Separator> & { orientation?: "horizontal" | "vertical" }) {
  const Grip = orientation === "horizontal" ? GripVertical : GripHorizontal;
  return (
    <Separator
      className={cn(
        "relative flex shrink-0 items-center justify-center bg-border/40 transition-colors",
        "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border",
        "hover:bg-primary/10 data-[separator]:active:bg-primary/15",
        orientation === "horizontal" ? "w-2" : "h-2 w-full",
        className,
      )}
      {...props}
    >
      <Grip
        className={cn(
          "z-10 h-3 w-3 text-muted-foreground/70",
          orientation === "vertical" && "rotate-90",
        )}
        aria-hidden
      />
    </Separator>
  );
}
