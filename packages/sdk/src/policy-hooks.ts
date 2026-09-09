import type { PaymentDenied } from "@agent-rails/contract";
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";

export type PolicyHookContext = {
  rpc: Rpc<SolanaRpcApi>;
  session: Address;
};

export type PolicyHook = (
  context: PolicyHookContext,
  intent: PaymentDenied,
) => Promise<void> | void;

export type PolicyHooks = {
  beforeSend?: PolicyHook[];
};

export async function runPolicyHooks(
  hooks: PolicyHook[] | undefined,
  context: PolicyHookContext,
  denial: PaymentDenied,
): Promise<void> {
  if (!hooks?.length) return;
  for (const hook of hooks) {
    await hook(context, denial);
  }
}
