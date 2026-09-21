import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Brain,
  Cable,
  CreditCard,
  Gauge,
  Home,
  Key,
  Settings,
  User,
  Wallet,
  Zap,
} from "lucide-react";

/**
 * Flat entries read as a list, not a navigation. Grouped by what the reader is
 * trying to do: run the operation, follow the money, configure the tooling,
 * manage themselves.
 *
 * RAG, Harness and Integrations were pruned along with their pages: none of the
 * three had backend infrastructure behind it, and a nav entry is a promise.
 */
export type NavItemDef = { href: string; labelKey: string; icon: LucideIcon };
export type NavGroupDef = { labelKey: string | null; items: NavItemDef[] };

export const navGroupDefs: NavGroupDef[] = [
  {
    labelKey: null,
    items: [{ href: "/", labelKey: "nav.home", icon: Home }],
  },
  {
    labelKey: "nav.operation",
    items: [
      { href: "/workflows", labelKey: "nav.workflows", icon: Zap },
      { href: "/agents", labelKey: "nav.agents", icon: Bot },
    ],
  },
  {
    labelKey: "nav.money",
    items: [
      { href: "/treasury", labelKey: "nav.treasury", icon: CreditCard },
      { href: "/limits", labelKey: "nav.limits", icon: Gauge },
      { href: "/wallets", labelKey: "nav.wallets", icon: Wallet },
    ],
  },
  {
    labelKey: "nav.tools",
    items: [
      { href: "/mcps", labelKey: "nav.mcps", icon: Cable },
      { href: "/skills", labelKey: "nav.skills", icon: Brain },
      { href: "/apis", labelKey: "nav.apis", icon: Key },
    ],
  },
  {
    labelKey: "nav.account",
    items: [
      { href: "/account", labelKey: "nav.account", icon: User },
      { href: "/profile", labelKey: "nav.profile", icon: Settings },
      { href: "/settings", labelKey: "nav.settings", icon: Settings },
    ],
  },
];
