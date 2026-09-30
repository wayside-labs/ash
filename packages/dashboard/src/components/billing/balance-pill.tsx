"use client";

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { useBilling } from "@/hooks/use-billing";
import { useRegion } from "@/hooks/use-region";
import { intlLocale } from "@/i18n";
import { useLocale, useTranslation } from "@/i18n/locale-provider";
import { formatBalance } from "@/lib/region";
import { BALANCE_PATH, balanceState } from "@/lib/shell";
import { cn } from "@/lib/utils";
import { useAppStore, useBalancesHidden } from "@/stores/app-store";

/**
 * The top bar's only money: the client's credit, in reais for a Brazilian viewer and dollars
 * for everyone else, beside Deposit and Withdraw. Renders nothing until the balance is known,
 * and nothing where billing is off or the viewer is signed out.
 */
export function BalancePill() {
  const { t } = useTranslation();
  const locale = intlLocale(useLocale());
  const hidden = useBalancesHidden();
  const region = useRegion();
  const setMoneyDialog = useAppStore((s) => s.setMoneyDialog);
  const { data } = useBilling();

  if (!data) return null;
  const state = balanceState(data);
  if (state === "off") return null;

  return (
    <div className="flex items-center gap-2 sm:gap-3">
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
          {hidden ? "••••" : formatBalance(data.balanceMicros, region, locale)}
        </span>
      </Link>
      <Button
        size="sm"
        variant={state === "funded" ? "outline" : "default"}
        onClick={() => setMoneyDialog("deposit")}
        aria-label={t("header.deposit")}
      >
        <ArrowDownToLine className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("header.deposit")}</span>
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setMoneyDialog("withdraw")}
        aria-label={t("header.withdraw")}
      >
        <ArrowUpFromLine className="h-3.5 w-3.5" />
        <span className="hidden sm:inline">{t("header.withdraw")}</span>
      </Button>
    </div>
  );
}
