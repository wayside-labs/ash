"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PUBLIC_ROUTES } from "@/lib/hosts";

const ITEMS = [
  { href: "/", label: "Início" },
  { href: "/blog", label: "Blog" },
  { href: "/blog/categorias", label: "Categorias" },
  { href: "/blog/autores", label: "Autores" },
] as const;

// The item the path belongs to: the longest one that is the path or a folder above it, so
// /blog/categorias marks "Categorias" and not "Blog", and /blog/<id> marks "Blog".
export function currentNavHref(pathname: string): string | null {
  let best: string | null = null;
  for (const { href } of ITEMS) {
    const matches = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
    if (matches && (best === null || href.length > best.length)) best = href;
  }
  return best;
}

// Same reading of the list as lib/hosts.ts: a prefix ends in "/", anything else is exact.
function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) =>
    route.endsWith("/") ? pathname.startsWith(route) : pathname === route,
  );
}

// Rendered by the root layout, which also wraps the public pages to come (newsletter,
// unsubscribe): on those paths the menu is not drawn. That is tidiness, not protection: the menu
// is links and nothing else, it also shows on the 404 page of the studio host, and what keeps a
// visitor out of the admin is each page's own guard.
export function Nav() {
  const pathname = usePathname();
  if (isPublicPath(pathname)) return null;
  const current = currentNavHref(pathname);
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="text-sm font-semibold tracking-tight text-ink">
          Ash Studio
        </Link>
        <nav aria-label="Principal" className="flex flex-wrap gap-1">
          {ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.href === current ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm ${
                item.href === current
                  ? "bg-elevated font-medium text-ink"
                  : "text-muted hover:text-ink"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
