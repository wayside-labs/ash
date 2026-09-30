import type { ReactNode } from "react";
import { GatedConnectButton } from "@/components/wallet/gated-connect-button";

interface PageHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /**
   * Show wallet Connect beside the actions. Set on the pages whose actions a wallet signs
   * (Treasury, Wallets, Limits, Agents); the top bar carries only the client's money.
   */
  wallet?: boolean;
}

export function PageHeader({ title, description, action, wallet = false }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {(action || wallet) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {wallet && <GatedConnectButton />}
          {action}
        </div>
      )}
    </div>
  );
}
