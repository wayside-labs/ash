"use client";

import { Pause, Play } from "lucide-react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Agent } from "@/lib/types";
import { cn, formatMoney, formatUsd, moneyTone, truncateAddress } from "@/lib/utils";

interface AgentCardProps {
  agent: Agent;
  compact?: boolean;
  className?: string;
  onClick?: () => void;
}

export function AgentCard({ agent, compact = false, className, onClick }: AgentCardProps) {
  const spent = agent.spentUsd ?? 0;
  const remaining = Math.max(agent.dailyLimitUsd - spent, 0);
  const statusVariant =
    agent.status === "active" ? "success" : agent.status === "paused" ? "warning" : "secondary";

  return (
    <Card
      onClick={onClick}
      className={cn(
        "transition-colors hover:border-primary/30",
        onClick && "cursor-pointer",
        className ?? "w-[200px] shrink-0",
      )}
    >
      <CardContent className={compact ? "p-3" : "p-4"}>
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate font-medium leading-tight">{agent.name}</p>
            <p className="truncate text-xs text-muted-foreground">{agent.role}</p>
          </div>
          <Badge variant={statusVariant} className="shrink-0 text-[10px]">
            {agent.status === "active" ? (
              <Play className="mr-0.5 h-2.5 w-2.5" />
            ) : (
              <Pause className="mr-0.5 h-2.5 w-2.5" />
            )}
            {agent.status}
          </Badge>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Saldo</span>
            <span className={cn("num font-medium", moneyTone(agent.balance))}>
              {formatMoney(agent.balance)}
            </span>
          </div>
          {agent.dailyLimitUsd > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Limite hoje</span>
              <span className="num num-col">{formatUsd(remaining)} restante</span>
            </div>
          )}
          {!compact && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Wallet</span>
                <span className="num">{truncateAddress(agent.walletAddress, 3)}</span>
              </div>
              {agent.paysTo.length > 0 && (
                <div>
                  <span className="text-muted-foreground">Paga para: </span>
                  <span>{agent.paysTo.join(", ")}</span>
                </div>
              )}
            </>
          )}
          {agent.demo && <DemoBadge className="mt-1" />}
        </div>
      </CardContent>
    </Card>
  );
}
