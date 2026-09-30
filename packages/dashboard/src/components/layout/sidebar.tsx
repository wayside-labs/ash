"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { useExternalWalletsAllowed } from "@/hooks/use-account-wallet";
import { useTranslation } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { isActiveHref, isAdvancedPath, type NavGroupDef, navTierDefs } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();
  const {
    sidebarCollapsed,
    sidebarHidden,
    setSidebarCollapsed,
    advancedNavOpen,
    setAdvancedNavOpen,
  } = useAppStore();
  const { t } = useTranslation();
  const tiers = useMemo(() => navTierDefs(), []);
  // Collapsing the section must never hide the page the reader is on.
  const insideAdvanced = isAdvancedPath(pathname, tiers);
  const advancedOpen = advancedNavOpen || insideAdvanced;

  return (
    <>
      {!sidebarCollapsed && (
        <button
          type="button"
          aria-label={t("header.closeMenu")}
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-56 flex-col border-r border-sidebar-border bg-sidebar transition-transform lg:static lg:translate-x-0",
          sidebarCollapsed ? "-translate-x-full" : "translate-x-0",
          // Desktop: folded away behind the header's menu button.
          sidebarHidden && "lg:hidden",
        )}
      >
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
            {t("common.menu")}
          </span>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-2">
          <NavGroups groups={tiers.simple} pathname={pathname} />

          <div className="border-t border-sidebar-border pt-3">
            <button
              type="button"
              aria-expanded={advancedOpen}
              aria-controls="nav-advanced"
              disabled={insideAdvanced}
              onClick={() => setAdvancedNavOpen(!advancedNavOpen)}
              className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-faint-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-faint-foreground"
            >
              {t("nav.advanced")}
              <ChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")}
                aria-hidden
              />
            </button>
            {advancedOpen && (
              <div id="nav-advanced" className="mt-2 space-y-4">
                <NavGroups groups={tiers.advanced} pathname={pathname} />
              </div>
            )}
          </div>
        </nav>
      </aside>
    </>
  );
}

function NavGroups({ groups, pathname }: { groups: NavGroupDef[]; pathname: string }) {
  const { t } = useTranslation();
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  // `undefined` while loading: no badge rather than one that blinks out for a Pro account.
  const showPro = useExternalWalletsAllowed() === false;

  return (
    <>
      {groups.map((group, index) => (
        <div key={group.labelKey ?? `group-${index}`}>
          {group.labelKey && (
            <p className="px-3 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-faint-foreground">
              {t(group.labelKey)}
            </p>
          )}
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const isActive = isActiveHref(item.href, pathname);
              const Icon = item.icon;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    prefetch={item.prefetch ?? true}
                    onClick={() => setSidebarCollapsed(true)}
                    className={cn(
                      "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                      isActive
                        ? "bg-elevated font-medium text-foreground"
                        : "text-muted-foreground hover:bg-elevated/60 hover:text-foreground",
                    )}
                  >
                    {isActive && (
                      <span
                        className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
                        aria-hidden
                      />
                    )}
                    <Icon className="h-4 w-4 shrink-0" />
                    {t(item.labelKey)}
                    {item.pro && showPro && (
                      <Badge variant="outline" className="ml-auto px-1.5 py-0 text-[10px]">
                        {t("nav.pro")}
                      </Badge>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </>
  );
}
