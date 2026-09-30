import { SHELL_MODE } from "@/lib/shell";
import { Header } from "./header";
import { Sidebar } from "./sidebar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar shellMode={SHELL_MODE} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header shellMode={SHELL_MODE} />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
