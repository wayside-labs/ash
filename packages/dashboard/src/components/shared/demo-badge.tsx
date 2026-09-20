import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Marks seeded rows. Anything carrying this badge has no on-chain counterpart,
 * so its numbers are illustrative — the distinction has to stay visible.
 */
export function DemoBadge({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn("border-dashed text-[10px] uppercase", className)}>
      demo
    </Badge>
  );
}
