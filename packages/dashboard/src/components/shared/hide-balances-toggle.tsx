"use client";

import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTranslation } from "@/i18n/locale-provider";
import { useAppStore, useBalancesHidden } from "@/stores/app-store";

/**
 * Hides every amount in the dashboard, credit and on-chain alike. It sits in the top bar beside
 * the balance, on every page, so it is where the money is rather than inside a wallet chip that
 * only some pages show.
 */
export function HideBalancesToggle() {
  const { t } = useTranslation();
  const hidden = useBalancesHidden();
  const balancesHidden = useAppStore((s) => s.balancesHidden);
  const hasHydrated = useAppStore((s) => s.hasHydrated);
  const setBalancesHidden = useAppStore((s) => s.setBalancesHidden);
  const label = hidden ? t("wallet.aria.showBalances") : t("wallet.aria.hideBalances");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          aria-label={label}
          aria-pressed={hidden}
          onClick={() => {
            if (!hasHydrated) return;
            setBalancesHidden(!balancesHidden);
          }}
        >
          {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
