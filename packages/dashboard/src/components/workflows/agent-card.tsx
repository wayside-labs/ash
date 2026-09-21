"use client";

import { Pause, Play } from "lucide-react";
import type { KeyboardEvent } from "react";
import { DemoBadge } from "@/components/shared/demo-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { intlLocale } from "@/i18n";
import { useTranslation } from "@/i18n/locale-provider";
import type { Agent } from "@/lib/types";
import { cn, formatMoney, formatUsd, moneyTone, truncateAddress } from "@/lib/utils";

interface AgentCardProps {
  agent: Agent;
  compact?: boolean;
  className?: string;
  onClick?: () => void;
}

export function AgentCard({ agent, compact = false, className, onClick }: AgentCardProps) {
  const { t, locale } = useTranslation();
  const spent = agent.spentUsd ?? 0;
  const remaining = Math.max(agent.dailyLimitUsd - spent, 0);
  const statusVariant =
    agent.status === "active" ? "success" : agent.status === "paused" ? "warning" : "secondary";
  const statusLabel =
    agent.status === "active"
      ? t("common.active")
      : agent.status === "paused"
        ? t("common.paused")
        : agent.status;

  // A clickable card is the only way into the edit dialog inside a workflow row,
  // so it has to answer the keyboard too — Card is a plain div.
  const activatable = onClick
    ? {
        onClick,
        role: "button" as const,
        tabIndex: 0,
        onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          onClick();
        },
      }
    : {};

  return (
    <Card
      {...activatable}
      className={cn(
        "transition-colors hover:border-primary/30",
        onClick &&
          "cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
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
            {statusLabel}
          </Badge>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t("common.balance")}</span>
            <span className={cn("num font-medium", moneyTone(agent.balance))}>
              {formatMoney(agent.balance)}
            </span>
          </div>
          {agent.dailyLimitUsd > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t("common.todayLimit")}</span>
              <span className="num num-col">
                {t("common.remaining", {
                  amount: formatUsd(remaining, intlLocale(locale)),
                })}
              </span>
            </div>
          )}
          {!compact && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t("common.wallet")}</span>
                <span className="num">{truncateAddress(agent.walletAddress, 3)}</span>
              </div>
              {agent.paysTo.length > 0 && (
                <div>
                  <span className="text-muted-foreground">{t("common.paysTo")} </span>
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
