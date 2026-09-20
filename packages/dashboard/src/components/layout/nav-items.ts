import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Brain,
  Cable,
  CreditCard,
  FileText,
  Gauge,
  Home,
  Key,
  Link2,
  Settings,
  User,
  Wallet,
  Wrench,
  Zap,
} from "lucide-react";

/**
 * Fifteen flat entries read as a list, not a navigation. Grouped by what the
 * reader is trying to do: run the operation, follow the money, configure the
 * tooling, manage themselves.
 */
export type NavItem = { href: string; label: string; icon: LucideIcon };
export type NavGroup = { label: string | null; items: NavItem[] };

export const navGroups: NavGroup[] = [
  {
    label: null,
    items: [{ href: "/", label: "Home", icon: Home }],
  },
  {
    label: "Operação",
    items: [
      { href: "/workflows", label: "Workflows", icon: Zap },
      { href: "/agents", label: "Agents", icon: Bot },
      { href: "/harness", label: "Harness", icon: Wrench },
    ],
  },
  {
    label: "Dinheiro",
    items: [
      { href: "/treasury", label: "Treasury", icon: CreditCard },
      { href: "/limits", label: "Limits", icon: Gauge },
      { href: "/wallets", label: "Wallets", icon: Wallet },
    ],
  },
  {
    label: "Ferramentas",
    items: [
      { href: "/mcps", label: "MCPs", icon: Cable },
      { href: "/skills", label: "Skills", icon: Brain },
      { href: "/rag", label: "RAG", icon: FileText },
      { href: "/apis", label: "My APIs", icon: Key },
      { href: "/integrations", label: "Integrações", icon: Link2 },
    ],
  },
  {
    label: "Conta",
    items: [
      { href: "/account", label: "Account", icon: User },
      { href: "/profile", label: "Profile", icon: Settings },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const navItems: NavItem[] = navGroups.flatMap((group) => group.items);
