import { isTransactionSignature, type RunErrorCode } from "@agent-rails/contract/template-run";

/** A run stopped for a reason the card can name. `cause` keeps the upstream error out of events. */
export class RunError extends Error {
  readonly code: RunErrorCode;
  /**
   * A transaction the SDK says landed although its call threw (the relay's reply was lost). It is
   * a public signature, never a secret, and the runner records it so a resume does not repeat the
   * step it belongs to.
   */
  readonly landedSignature: string | undefined;

  constructor(
    code: RunErrorCode,
    message?: string,
    options?: { cause?: unknown; landedSignature?: string },
  ) {
    super(
      message ?? RUN_ERROR_MESSAGES[code],
      options?.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "RunError";
    this.code = code;
    this.landedSignature = options?.landedSignature;
  }
}

/** Default wording, in English; the dashboard shows its own translation per code. */
export const RUN_ERROR_MESSAGES: Record<RunErrorCode, string> = {
  mainnet_disabled: "Private payouts on mainnet are switched off on this install.",
  wallet_missing: "Connect a wallet first.",
  wallet_rejected: "Signature rejected in the wallet.",
  wallet_not_allowed: "This wallet is not on the list allowed to run private payouts.",
  wallet_cannot_sign_messages: "This wallet cannot sign messages, which Cloak needs.",
  insufficient_balance: "The wallet does not hold enough SOL for this run.",
  below_minimum: "An amount is below what Cloak accepts.",
  payee_invalid: "A payee address is not usable for this run.",
  circuits_unreachable: "Cloak's proving files could not be loaded.",
  relay_unreachable: "Cloak's relay could not be reached.",
  rpc_unreachable: "The Solana RPC could not be reached.",
  swap_quote_unavailable: "No ZEC quote is available right now.",
  quote_moved:
    "The ZEC quote moved since you reviewed it. Review the new minimum and approve again.",
  approval_too_slow:
    "The wallet approval took too long and Cloak's request expired. Nothing was submitted.",
  run_in_progress: "A private payout is already running in this browser for this wallet.",
  keys_not_deterministic:
    "The wallet signs the same message differently each time, so the private keys cannot be derived from it. Nothing was spent.",
  keys_mismatch:
    "This wallet derives different keys than an earlier run on this device. Nothing was spent.",
  outcome_unknown:
    "The result of a step is unknown. Check the explorer before running again; funds may be in the Cloak pool.",
  aborted: "The run was stopped.",
  unknown: "The run failed. Details are in the browser console.",
};

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message: unknown };
    if (typeof message === "string") return message;
  }
  return "";
}

function codeOf(error: unknown): unknown {
  return error && typeof error === "object" && "code" in error
    ? (error as { code: unknown }).code
    : undefined;
}

/**
 * What the SDK knows about a spend whose reply it lost. `SettlementVerificationError` carries the
 * chain's verdict: `landed` (the inputs are spent, do not retry), `unknown` (it could not tell),
 * or `not-landed` / `failed` (nothing was consumed). Read by name and shape, so this module stays
 * free of the SDK import and still recognises the error across a bundler's copy of the class.
 */
function settlementOf(error: unknown): { outcome: string; signature: string | undefined } | null {
  if (!error || typeof error !== "object") return null;
  const { name, outcome, signature } = error as Record<string, unknown>;
  if (name !== "SettlementVerificationError" || typeof outcome !== "string") return null;
  return {
    outcome,
    signature:
      typeof signature === "string" && isTransactionSignature(signature) ? signature : undefined,
  };
}

/**
 * Text the SDK uses when a step reached the chain, or may have, without a clean result: a swap
 * that timed out or was refunded, a relay success the chain would not confirm, a landed spend
 * whose indices never came back. Read before the wallet-rejection pattern, whose "cancelled"
 * would otherwise swallow "Swap execution cancelled".
 */
const OUTCOME_UNKNOWN = new RegExp(
  [
    "outcome (is )?unknown",
    "may have landed",
    "SubmissionOutcomeUnknown",
    "could not be (confirmed|resolved)",
    "did not complete within timeout",
    "swap (execution )?(was )?(cancell?ed|refunded)",
    "succeeded but commitment indices missing",
  ].join("|"),
  "i",
);

/**
 * Wallets reject with plain `{ code, message }` objects as often as with Errors, and the SDK
 * throws strings it built from relay responses; neither is shown to the operator. They are
 * mapped to a code and the original goes to `cause` for the console.
 */
export function classifyError(error: unknown, fallback: RunErrorCode = "unknown"): RunError {
  if (error instanceof RunError) return error;
  const settled = settlementOf(error);
  if (settled && (settled.outcome === "landed" || settled.outcome === "unknown")) {
    return new RunError("outcome_unknown", undefined, {
      cause: error,
      ...(settled.outcome === "landed" && settled.signature
        ? { landedSignature: settled.signature }
        : {}),
    });
  }
  const text = messageOf(error);
  const name = error instanceof Error ? error.name : "";

  let code: RunErrorCode = fallback;
  if (name === "AbortError" || /\babort(ed)?\b/i.test(text)) code = "aborted";
  else if (/\bWALLET_CANNOT_SIGN_MESSAGES\b/.test(text)) code = "wallet_cannot_sign_messages";
  else if (/\bWALLET_NOT_FOUND\b/.test(text)) code = "wallet_missing";
  else if (OUTCOME_UNKNOWN.test(text)) code = "outcome_unknown";
  else if (/approval took|stay valid|nothing was submitted/i.test(text)) code = "approval_too_slow";
  else if (
    codeOf(error) === 4001 ||
    /user rejected|rejected the request|request rejected|user denied|declined|cancell?ed/i.test(
      text,
    )
  )
    code = "wallet_rejected";
  else if (/insufficient (funds|lamports|balance)/i.test(text)) code = "insufficient_balance";
  else if (/amount too small|too small|below.*minimum|minimum is/i.test(text))
    code = "below_minimum";
  // A proof the circuit refused is a bug or a bad input, not a missing download.
  else if (/assert(ion)? failed|constraint .*(not satisfied|failed)/i.test(text)) code = "unknown";
  else if (/circuit/i.test(text)) code = "circuits_unreachable";
  else if (/\b403\b|access forbidden/i.test(text) && fallback === "rpc_unreachable")
    code = "rpc_unreachable";
  else if (/failed to fetch|fetch failed|networkerror|econnrefused|enotfound|etimedout/i.test(text))
    code = fallback === "unknown" ? "relay_unreachable" : fallback;

  return new RunError(code, undefined, { cause: error });
}

/**
 * For the console only. Long opaque tokens (proofs, blindings, keys) are cut so a stray SDK error
 * body cannot put one into a log the operator might paste somewhere. 32 characters is the length
 * of a base58 or base64 secret key; a 64-character one is hex.
 */
export function describeForConsole(error: unknown): string {
  const text = messageOf(error) || String(error);
  return text
    .replace(/[A-Za-z0-9+/=_-]{32,}/g, (token) => `${token.slice(0, 8)}…[${token.length}]`)
    .slice(0, 400);
}
