"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/app-store";
import { navGroups } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();
  const { sidebarCollapsed, setSidebarCollapsed, operationMode } = useAppStore();

  return (
    <>
      {/*
       * Below lg the aside is a fixed drawer, so the backdrop belongs to the
       * OPEN state. It was keyed to the collapsed state, which meant the drawer
       * sat over the page with nothing to dismiss it on a narrow viewport.
       */}
      {!sidebarCollapsed && (
        <button
          type="button"
          aria-label="Fechar menu"
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
        <div className="flex h-14 items-center border-b border-sidebar-border px-4">
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-subtle-foreground">
            Menu
          </span>
        </div>

        <nav className="flex-1 space-y-4 overflow-y-auto p-2">
          {navGroups.map((group, index) => (
            <div key={group.label ?? `group-${index}`}>
              {group.label && (
                <p className="px-3 pb-1.5 pt-1 text-[10px] font-medium uppercase tracking-[0.14em] text-faint-foreground">
                  {group.label}
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
                        onClick={() => setSidebarCollapsed(true)}
                        className={cn(
                          "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                          isActive
                            ? "bg-elevated font-medium text-foreground"
                            : "text-muted-foreground hover:bg-elevated/60 hover:text-foreground",
                        )}
                      >
                        {/* A 2px rail beats a filled pill for marking place. */}
                        {isActive && (
                          <span
                            className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
                            aria-hidden
                          />
                        )}
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-sidebar-border p-3">
          <p className="text-[11px] text-faint-foreground">Modo</p>
          <p className="flex items-center gap-1.5 text-xs text-foreground">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                operationMode === "agent-rails" ? "bg-primary" : "bg-border-strong",
              )}
              aria-hidden
            />
            {operationMode === "native" ? "Solana Nativo" : "Agent Rails Vault"}
          </p>
        </div>
      </aside>
    </>
  );
}
