import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "./globals.css";
import type { ReactNode } from "react";
import { Nav } from "@/ui/nav";

export const metadata = { title: "Ash Studio", robots: { index: false, follow: false } };

// No guard and no data here, on purpose (tests/app-guards.test.ts): the menu is links only, and
// every page it points at guards itself.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen antialiased">
        <Nav />
        {children}
      </body>
    </html>
  );
}
