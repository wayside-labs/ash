/**
 * ADR-024: which account may connect a self-custody wallet.
 *
 * This is a product tier, not a security boundary. Anyone can open devtools and call
 * `window.phantom.solana.connect()`; what a wallet may *do* is decided by the program against
 * the on-chain owner and operator, never by this flag. The gate exists so the default path
 * never asks a newcomer for an extension or a seed phrase.
 */
export type Plan = "free" | "pro";

/**
 * `pro` is the product rule. `everyone` exists for deployments whose demo still runs through
 * Phantom — the treasury bootstrap signs with an external wallet until a platform wallet can.
 */
export type ExternalWalletPolicy = "pro" | "everyone";

export function parseExternalWalletPolicy(raw: string | undefined): ExternalWalletPolicy {
  return raw?.trim().toLowerCase() === "everyone" ? "everyone" : "pro";
}

/**
 * Local JSON mode has no accounts to tier: it is the operator's own machine, and the wallet
 * they connect is the only signer the dashboard has. Gating it would break the tool without
 * protecting anything.
 */
export function canConnectExternalWallet(input: {
  hosted: boolean;
  plan: Plan;
  policy: ExternalWalletPolicy;
}): boolean {
  if (!input.hosted) return true;
  return input.policy === "everyone" || input.plan === "pro";
}
