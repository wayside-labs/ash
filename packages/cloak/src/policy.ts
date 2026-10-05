import type { RunErrorCode } from "@ash/contract/template-run";
import {
  type CloakPayoutProposal,
  isSolanaAddress,
  parseSolToLamports,
} from "@ash/contract/template-run";
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
  /** The operator's contacts: label to address. A payee must be one of these, exactly. */
  contacts: ReadonlyMap<string, string>;
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

const CONTACT_LABEL = /^[\p{L}\p{N} ._-]{1,40}$/u;

/**
 * Parses the operator's contact list, a JSON object of label to address. Anything that does not
 * parse, or an entry that is not a valid label and address, is dropped: a typo shrinks the list,
 * it never adds a payee nobody named.
 */
export function parseContacts(raw: string | undefined): Map<string, string> {
  const contacts = new Map<string, string>();
  if (!raw?.trim()) return contacts;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return contacts;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return contacts;
  for (const [label, address] of Object.entries(value)) {
    const name = label.trim();
    if (!CONTACT_LABEL.test(name)) continue;
    if (typeof address !== "string" || !isSolanaAddress(address)) continue;
    contacts.set(name, address);
  }
  return contacts;
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
  // The model names a contact; the address comes from the operator's list. A label that is not on
  // the list, or an address that is not the one listed for it, is refused before anything moves.
  for (const payee of proposal.payees) {
    if (ctx.contacts.get(payee.label) !== payee.address) return deny("payee_invalid");
  }
  // A swap under Cloak's floor is refused by the relay after the deposit has already moved, so it
  // is turned away here, while nothing has.
  for (const payee of proposal.payees) {
    if (payee.deliver !== "ZEC") continue;
    const gross = parseSolToLamports(payee.amountSol);
    if (gross === null || netAfterExitFee(gross) < MIN_SWAP_LAMPORTS) return deny("below_minimum");
  }
  return { ok: true };
}
