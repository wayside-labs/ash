import type { RunErrorCode } from "@agent-rails/contract/template-run";
import {
  type CloakPayoutProposal,
  isSolanaAddress,
  parseSolToLamports,
} from "@agent-rails/contract/template-run";
import { MIN_SWAP_LAMPORTS } from "./constants.js";
import { RUN_ERROR_MESSAGES } from "./errors.js";
import { netAfterExitFee } from "./fees.js";

export type RunPolicyContext = {
  /** The connected wallet that would fund and sign the run. */
  funder: string | null;
  /** `NEXT_PUBLIC_CLOAK_MAINNET === "1"`, read by the caller (it is inlined at build time). */
  mainnetEnabled: boolean;
  /** Wallets the operator allowed to run this template. Empty allows nobody. */
  allowedWallets: readonly string[];
};

export type PolicyResult = { ok: true } | { ok: false; code: RunErrorCode; message: string };

function deny(code: RunErrorCode): PolicyResult {
  return { ok: false, code, message: RUN_ERROR_MESSAGES[code] };
}

/**
 * Parses the operator's allow list (comma or whitespace separated). An entry that is not an
 * address is dropped rather than kept: a typo must shrink the list, never widen what it matches.
 */
export function parseAllowedWallets(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .filter(isSolanaAddress);
}

/**
 * The gate in front of the card's Run button. It is advisory against the operator and binding
 * against the model: the proposal cannot change any of it. The allow list fails closed, so a
 * deployment that turned mainnet on and forgot the list lets nobody run.
 */
export function checkRunPolicy(proposal: CloakPayoutProposal, ctx: RunPolicyContext): PolicyResult {
  if (!ctx.mainnetEnabled) return deny("mainnet_disabled");
  if (!ctx.funder) return deny("wallet_missing");
  if (!ctx.allowedWallets.includes(ctx.funder)) return deny("wallet_not_allowed");
  // Paying yourself through the pool re-creates the link the template exists to hide.
  if (proposal.payees.some((payee) => payee.address === ctx.funder)) return deny("payee_invalid");
  // A swap under Cloak's floor is refused by the relay after the deposit has already moved, so it
  // is turned away here, while nothing has.
  for (const payee of proposal.payees) {
    if (payee.deliver !== "ZEC") continue;
    const gross = parseSolToLamports(payee.amountSol);
    if (gross === null || netAfterExitFee(gross) < MIN_SWAP_LAMPORTS) return deny("below_minimum");
  }
  return { ok: true };
}
