"use client";

import Link from "next/link";
import { useBilling } from "@/hooks/use-billing";
import { intlLocale } from "@/i18n";
import { useLocale, useTranslation } from "@/i18n/locale-provider";
import { formatMicros } from "@/lib/billing";
import { BALANCE_PATH, balanceState } from "@/lib/shell";
import { cn } from "@/lib/utils";
import { useBalancesHidden } from "@/stores/app-store";
import { AddBalanceButton } from "./add-balance-button";

/**
 * The simple shell's header money: the chat credit, not SOL. Renders nothing until the balance
 * is known and nothing at all where billing is off — a local operator has no credit to show.
 */
export function BalancePill() {
  const { t } = useTranslation();
  const locale = intlLocale(useLocale());
  const hidden = useBalancesHidden();
  const { data } = useBilling();

  if (!data) return null;
  const state = balanceState(data);
  if (state === "off") return null;

  return (
    <div className="flex items-center gap-2">
      <Link
        href={BALANCE_PATH}
        className="flex flex-col items-end leading-tight"
        data-testid="header-balance"
      >
        <span className="text-[10px] uppercase tracking-[0.12em] text-faint-foreground">
          {t("balance.label")}
        </span>
        <span
          className={cn(
            "num text-sm font-medium",
            state === "funded" ? "text-foreground" : "text-destructive",
          )}
        >
          {hidden ? "••••" : formatMicros(data.balanceMicros, locale)}
        </span>
      </Link>
      <AddBalanceButton variant={state === "funded" ? "outline" : "default"} />
    </div>
  );
}
