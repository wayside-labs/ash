import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Brain,
  Cable,
  ChartNoAxesColumn,
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
export type NavItemDef = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  /** Default true. Heavy or rare routes opt out to save idle prefetch bandwidth. */
  prefetch?: boolean;
};
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
      // First in the group: it is the page that sends the reader to the other three.
      { href: "/metrics", labelKey: "nav.metrics", icon: ChartNoAxesColumn },
      { href: "/treasury", labelKey: "nav.treasury", icon: CreditCard },
      { href: "/limits", labelKey: "nav.limits", icon: Gauge },
      { href: "/wallets", labelKey: "nav.wallets", icon: Wallet },
    ],
  },
  {
    labelKey: "nav.tools",
    items: [
      { href: "/mcps", labelKey: "nav.mcps", icon: Cable, prefetch: false },
      { href: "/skills", labelKey: "nav.skills", icon: Brain, prefetch: false },
      { href: "/apis", labelKey: "nav.apis", icon: Key, prefetch: false },
    ],
  },
  {
    labelKey: "nav.account",
    items: [
      { href: "/account", labelKey: "nav.account", icon: User, prefetch: false },
      { href: "/profile", labelKey: "nav.profile", icon: Settings, prefetch: false },
      { href: "/settings", labelKey: "nav.settings", icon: Settings, prefetch: false },
    ],
  },
];
