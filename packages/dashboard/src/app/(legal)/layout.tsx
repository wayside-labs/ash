import Link from "next/link";
import { LegalLinks } from "@/components/legal/legal-links";

/**
 * Outside the dashboard shell on purpose: no sidebar, no wallet or deposit dialogs, nothing that
 * needs a session. These pages are read before signing in (see `LEGAL_PATHS`).
 */
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-4">
          <Link href="/" className="text-sm font-semibold tracking-tight">
            Agent Rails
          </Link>
          <LegalLinks />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">{children}</main>
    </div>
  );
}
