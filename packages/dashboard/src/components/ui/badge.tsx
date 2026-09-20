import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary/12 text-primary",
        secondary: "border-transparent bg-secondary text-muted-foreground",
        outline: "border-border text-subtle-foreground",
        // Status variants mirror the reserved scale in globals.css.
        warning: "border-transparent bg-warning/12 text-warning",
        serious: "border-transparent bg-serious/12 text-serious",
        destructive: "border-transparent bg-critical/12 text-critical",
        success: "border-transparent bg-good/12 text-good",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
