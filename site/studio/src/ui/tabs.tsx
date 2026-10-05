import Link from "next/link";

export type TabItem = { href: string; label: string; count?: number; current: boolean };

// Tabs and filters are links: the state is the URL, so it survives a reload, can be shared, and
// the server renders the right list without any client code.
export function Tabs({
  label,
  items,
  variant = "tabs",
}: {
  // What this group of links is, for a screen reader ("Seções do blog", "Filtrar por estado").
  label: string;
  items: readonly TabItem[];
  // "tabs" switches what the page shows; "pills" narrows a list.
  variant?: "tabs" | "pills";
}) {
  const tabs = variant === "tabs";
  return (
    <nav
      aria-label={label}
      className={tabs ? "flex flex-wrap gap-1 border-b border-line" : "flex flex-wrap gap-1"}
    >
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.current ? (tabs ? "page" : "true") : undefined}
          className={
            tabs
              ? `-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                  item.current
                    ? "border-settle text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`
              : `rounded-md border px-2.5 py-1 text-[13px] ${
                  item.current
                    ? "border-line-strong bg-elevated text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`
          }
        >
          {item.label}
          {item.count === undefined ? null : (
            // muted, not faint: on the elevated pill of the current filter, faint is under AA.
            <span className="ml-1.5 font-mono text-xs tabular-nums text-muted">{item.count}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
