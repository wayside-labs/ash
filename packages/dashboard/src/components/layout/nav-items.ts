import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Bot,
  Brain,
  Cable,
  ChartNoAxesColumn,
  CircleDollarSign,
  CreditCard,
  Gauge,
  Inbox,
  Key,
  LayoutTemplate,
  MessageSquare,
  Settings,
  User,
  UserCog,
  Wallet,
  Zap,
} from "lucide-react";
import { ACCOUNT_PATH, BALANCE_PATH } from "@/lib/shell";

/**
 * Two tiers. Simple is the whole product for someone who signed in to ask a question: chat,
 * balance, account. Advanced is the operator's dashboard — workflows, agents, wallets, settings —
 * grouped the way the whiteboard draws it, and collapsed until the reader goes looking.
 *
 * A nav entry is a promise: every page listed here has a backend behind it. Knowledge (RAG)
 * came back once it had indexing and search; Integrations live under Settings as channels.
 */
export type NavItemDef = {
  href: string;
  labelKey: string;
  icon: LucideIcon;
  /** Default true. Heavy or rare routes opt out to save idle prefetch bandwidth. */
  prefetch?: boolean;
  /**
   * Needs an external wallet, which ADR-024 makes a Pro feature on hosted accounts. The badge
   * shows only to a viewer the gate would refuse; the route itself stays open.
   */
  pro?: boolean;
};
export type NavGroupDef = { labelKey: string | null; items: NavItemDef[] };
export type NavTierDefs = { simple: NavGroupDef[]; advanced: NavGroupDef[] };

export function navTierDefs(): NavTierDefs {
  return {
    simple: [
      {
        labelKey: null,
        items: [
          { href: "/", labelKey: "nav.chat", icon: MessageSquare },
          { href: BALANCE_PATH, labelKey: "nav.balance", icon: CircleDollarSign },
          { href: ACCOUNT_PATH, labelKey: "nav.account", icon: User, prefetch: false },
        ],
      },
    ],
    advanced: [
      {
        labelKey: "nav.workflowsGroup",
        items: [
          { href: "/templates", labelKey: "nav.templates", icon: LayoutTemplate },
          { href: "/workflows", labelKey: "nav.workflows", icon: Zap },
          { href: "/reviews", labelKey: "nav.reviews", icon: Inbox },
        ],
      },
      {
        labelKey: "nav.agentsGroup",
        items: [
          { href: "/agents", labelKey: "nav.agents", icon: Bot },
          { href: "/mcps", labelKey: "nav.mcps", icon: Cable, prefetch: false },
          { href: "/skills", labelKey: "nav.skills", icon: Brain, prefetch: false },
          { href: "/knowledge", labelKey: "nav.knowledge", icon: BookOpen, prefetch: false },
          { href: "/apis", labelKey: "nav.apis", icon: Key, prefetch: false },
        ],
      },
      {
        labelKey: "nav.walletsGroup",
        items: [
          // First in the group: it is the page that sends the reader to the other three.
          { href: "/metrics", labelKey: "nav.metrics", icon: ChartNoAxesColumn },
          { href: "/treasury", labelKey: "nav.treasury", icon: CreditCard, pro: true },
          { href: "/limits", labelKey: "nav.limits", icon: Gauge },
          { href: "/wallets", labelKey: "nav.wallets", icon: Wallet, pro: true },
        ],
      },
      {
        labelKey: "nav.settingsGroup",
        items: [
          { href: "/profile", labelKey: "nav.profile", icon: UserCog, prefetch: false },
          { href: "/settings", labelKey: "nav.settings", icon: Settings, prefetch: false },
        ],
      },
    ],
  };
}

export function isActiveHref(href: string, pathname: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** The Advanced section opens itself when the reader is already inside it. */
export function isAdvancedPath(pathname: string, tiers: NavTierDefs): boolean {
  return tiers.advanced.some((group) =>
    group.items.some((item) => isActiveHref(item.href, pathname)),
  );
}
