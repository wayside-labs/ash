import { DepositDialog } from "@/components/billing/deposit-dialog";
import { WithdrawDialog } from "@/components/billing/withdraw-dialog";
import { LegalLinks } from "@/components/legal/legal-links";
import { WalletAutoRestore } from "@/components/wallet/wallet-auto-restore";
import { Header } from "./header";
import { Sidebar } from "./sidebar";

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
        <footer className="flex shrink-0 justify-end border-t border-border px-4 py-2 md:px-6">
          <LegalLinks />
        </footer>
      </div>
      {/* Mounted once: the header, the chat's refused reply and /balance all open these. */}
      <DepositDialog />
      <WithdrawDialog />
      <WalletAutoRestore />
    </div>
  );
}
