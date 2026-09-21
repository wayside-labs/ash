"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "@/i18n/locale-provider";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { navGroupDefs } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed, operationMode } = useAppStore();
  const { t } = useTranslation();

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
        )}
      >
        <div className="flex h-16 items-center border-b border-sidebar-border px-4">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
            {t("common.menu")}
          </span>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-2">
          {navGroupDefs.map((group, index) => (
            <div key={group.labelKey ?? `group-${index}`}>
              {group.labelKey && (
                <p className="px-3 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-faint-foreground">
                  {t(group.labelKey)}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive =
                    item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
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
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <p className="text-[11px] text-faint-foreground">{t("common.mode")}</p>
          <p className="flex items-center gap-1.5 text-xs text-foreground">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                operationMode === "agent-rails" ? "bg-primary" : "bg-border-strong",
              )}
              aria-hidden
            />
            {operationMode === "native" ? t("mode.native") : t("mode.agentRails")}
          </p>
        </div>
      </aside>
    </>
  );
}
