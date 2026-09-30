"use client";

import { Menu, Shield } from "lucide-react";
import { BalancePill } from "@/components/billing/balance-pill";
import { HideBalancesToggle } from "@/components/shared/hide-balances-toggle";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/use-media-query";
import { useTranslation } from "@/i18n/locale-provider";
import { useAppStore } from "@/stores/app-store";

/**
 * The top bar is the client's money and nothing else: balance, Deposit, Withdraw. The operator
 * controls that used to live here moved to where they are used — the cluster to Settings, the
 * wallet Connect button into the pages that sign (Treasury, Wallets, Limits, Agents).
 */
export function Header() {
  const { sidebarCollapsed, sidebarHidden, setSidebarCollapsed, setSidebarHidden } = useAppStore();
  const desktop = useMediaQuery("(min-width: 1024px)");
  const { t } = useTranslation();

  // One button, two behaviours: on desktop it folds the sidebar away, below `lg` it opens the
  // overlay drawer.
  const toggle = () =>
    desktop ? setSidebarHidden(!sidebarHidden) : setSidebarCollapsed(!sidebarCollapsed);

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/50 px-4 backdrop-blur-sm">
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={toggle}
          aria-label={t("header.toggleMenu")}
          aria-expanded={desktop ? !sidebarHidden : !sidebarCollapsed}
          data-testid="menu-toggle"
        >
          <Menu className="h-4 w-4" />
        </Button>

        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-primary" />
          <span className="hidden font-semibold sm:inline">{t("header.brand")}</span>
        </div>
      </div>

      <div className="flex items-center gap-1 sm:gap-2">
        <HideBalancesToggle />
        <BalancePill />
      </div>
    </header>
  );
}
