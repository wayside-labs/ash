"use client";

import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useBilling } from "@/hooks/use-billing";
import { useTranslation } from "@/i18n/locale-provider";
import { balanceState } from "@/lib/shell";
import { useAppStore } from "@/stores/app-store";

/**
 * Deposit and Withdraw in the top bar. The balance itself is not shown there: it lives on the
 * balance page. Renders nothing until billing answers, and nothing where billing is off or the
 * viewer is signed out.
 */
export function BalancePill() {
  const { t } = useTranslation();
  const setMoneyDialog = useAppStore((s) => s.setMoneyDialog);
  const { data } = useBilling();

  if (!data) return null;
  const state = balanceState(data);
  if (state === "off") return null;

  return (
    <div className="flex items-center gap-2 sm:gap-3">
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
